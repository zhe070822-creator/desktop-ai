const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

const MODELS_DIR = path.join(__dirname, '..', 'models');

const providerEl = document.getElementById('provider');
const apikeyEl = document.getElementById('apikey');
const apiurlEl = document.getElementById('apiurl');
const modelNameEl = document.getElementById('model-name');
const modelSelectEl = document.getElementById('model-select');
const saveBtn = document.getElementById('save-btn');
const importBtn = document.getElementById('import-btn');
const optimizeBtn = document.getElementById('optimize-btn');
const optimizeInput = document.getElementById('optimize-input');
const importCharfileBtn = document.getElementById('import-charfile-btn');
const importMultiBtn = document.getElementById('import-multi-btn');
const exportBtn = document.getElementById('export-btn');
const importDataBtn = document.getElementById('import-data-btn');
const testBtn = document.getElementById('test-btn');
const statusEl = document.getElementById('status');

const defaults = {
  deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  claude:   { url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-6' },
  openai:   { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' },
  custom:   { url: '', model: '' },
};

providerEl.addEventListener('change', () => {
  const d = defaults[providerEl.value];
  apiurlEl.value = d.url; modelNameEl.value = d.model;
});

function status(msg) { statusEl.textContent = msg; }

async function refreshModels() {
  modelSelectEl.innerHTML = '';
  const models = await ipcRenderer.invoke('get-models');
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.name; opt.textContent = m.character?.name || m.name;
    modelSelectEl.appendChild(opt);
  });
  if (modelSelectEl.options.length > 0) modelSelectEl.value = modelSelectEl.options[0].value;
}

async function init() {
  await refreshModels();

  const existing = await ipcRenderer.invoke('get-settings');
  if (existing) {
    providerEl.value = existing.provider || 'deepseek';
    apikeyEl.value = existing.apiKey || '';
    apiurlEl.value = existing.apiUrl || '';
    modelNameEl.value = existing.model || '';
    modelSelectEl.value = existing.activeModel || modelSelectEl.options[0]?.value || '';
  } else {
    providerEl.value = 'custom';
  }
}

importBtn.addEventListener('click', async () => {
  status('正在导入...');
  const result = await ipcRenderer.invoke('import-model');
  if (result) {
    await refreshModels();
    status(result.error ? `导入失败: ${result.error}` : '导入成功！');
  } else {
    status('已取消');
  }
});

async function importCharFile(multi) {
  const result = await ipcRenderer.invoke(multi ? 'import-charfiles-multi' : 'import-charfile');
  if (result && result.content) {
    optimizeInput.value = optimizeInput.value ? optimizeInput.value + '\n\n' + result.content : result.content;
  }
}

importCharfileBtn.addEventListener('click', () => importCharFile(false));
importMultiBtn.addEventListener('click', () => importCharFile(true));

const optimizeHint = document.getElementById('optimize-hint');

function checkOptimizeInput() {
  const has = optimizeInput.value.trim().length > 0;
  optimizeBtn.disabled = !has;
  if (optimizeHint) {
    optimizeHint.textContent = has ? 'AI 将上述内容与当前角色卡融合，生成完整角色设定' : '请先输入新角色描述或导入文件';
    optimizeHint.style.color = has ? '#888' : '#e74c3c';
  }
}

optimizeInput.addEventListener('input', checkOptimizeInput);

// 文件导入后触发检查
const origImportCharFile = importCharFile;
importCharFile = async function(multi) {
  await origImportCharFile(multi);
  checkOptimizeInput();
};

optimizeBtn.addEventListener('click', async () => {
  const modelName = modelSelectEl.value;
  const userInput = optimizeInput.value.trim();
  if (!modelName) { status('请先选择模型'); return; }
  if (!userInput) { status('请先输入新角色描述或导入文件'); return; }
  status('正在调用 AI 优化角色卡...');
  optimizeBtn.disabled = true;
  // 问题2：把当前表单的 API 配置一起传过去，无需先点"保存并启动"
  const formApiConfig = {
    provider: providerEl.value,
    apiKey: apikeyEl.value.trim(),
    apiUrl: apiurlEl.value.trim() || defaults[providerEl.value].url,
    model: modelNameEl.value.trim() || defaults[providerEl.value].model,
  };
  const result = await ipcRenderer.invoke('optimize-character-card', modelName, userInput, formApiConfig);
  optimizeBtn.disabled = false;
  checkOptimizeInput();
  if (result.error) { status(`优化失败: ${result.error}`); return; }
  status('角色卡已优化！');
  await refreshModels();
  modelSelectEl.value = modelName;
});

// === 导出/导入 ===
exportBtn.addEventListener('click', async () => {
  const modelName = modelSelectEl.value;
  if (!modelName) { status('请先选择模型'); return; }

  const modelDir = path.join(MODELS_DIR, modelName);
  const charFile = path.join(modelDir, 'character.json');
  const memFile = path.join(modelDir, 'memory.json');

  let character = null;
  let memory = null;

  try {
    if (fs.existsSync(charFile)) {
      character = JSON.parse(fs.readFileSync(charFile, 'utf-8'));
    }
  } catch (e) { status(`读取角色卡失败: ${e.message}`); return; }

  if (!character) { status('该模型没有角色卡可导出'); return; }

  try {
    if (fs.existsSync(memFile)) {
      const raw = JSON.parse(fs.readFileSync(memFile, 'utf-8'));
      // 规范化格式：兼容旧版纯数组 memory
      if (Array.isArray(raw)) {
        memory = { facts: [], messages: raw };
      } else {
        memory = { facts: raw.facts || [], messages: raw.messages || [] };
      }
    }
  } catch (e) { /* 记忆文件可能损坏，不影响导出 */ }

  if (!memory) memory = { facts: [], messages: [] };

  const exportData = {
    type: 'desktop-ai-export',
    version: 1,
    modelName,
    exportDate: new Date().toISOString(),
    character,
    memory,
  };

  const factCount = memory.facts.length;
  const msgCount = memory.messages.length;
  status(`正在导出... (角色: ${character.name}, 记忆: ${factCount}条事实 + ${msgCount}条对话)`);

  const result = await ipcRenderer.invoke('export-character', modelName, exportData);
  if (!result) { status('已取消'); return; }
  if (result.error) { status(`导出失败: ${result.error}`); return; }
  status(`✅ 导出成功！角色"${character.name}"(${factCount}+${msgCount}条记忆)已保存。`);
});

importDataBtn.addEventListener('click', async () => {
  const modelName = modelSelectEl.value;
  if (!modelName) { status('请先选择模型'); return; }

  status('正在读取文件...');
  const result = await ipcRenderer.invoke('import-character');
  if (!result) { status('已取消'); return; }
  if (result.error) { status(`导入失败: ${result.error}`); return; }

  const { data } = result;

  // 检查导出模型与当前选中模型是否匹配
  if (data.modelName && data.modelName !== modelName) {
    const confirmed = await ipcRenderer.invoke('confirm-dialog',
      '模型不匹配',
      `导入数据来自模型"${data.modelName}"，但当前选中的是"${modelName}"。\n\n是否仍要导入到"${modelName}"？`
    );
    if (!confirmed) { status('已取消'); return; }
  }

  // 确认覆盖
  const overwriteConfirmed = await ipcRenderer.invoke('confirm-dialog',
    '确认导入',
    `将把导出的角色卡和记忆导入到"${modelName}"。\n\n当前的角色卡和记忆将被覆盖（会自动备份）。\n\n角色名: ${data.character.name}\n记忆条数: ${data.memory ? data.memory.facts.length + data.memory.messages.length : 0}\n导出日期: ${data.exportDate || '未知'}\n\n确认导入？`
  );
  if (!overwriteConfirmed) { status('已取消'); return; }

  const modelDir = path.join(MODELS_DIR, modelName);
  const charFile = path.join(modelDir, 'character.json');
  const memFile = path.join(modelDir, 'memory.json');

  try {
    // 备份旧文件
    if (fs.existsSync(charFile)) {
      fs.writeFileSync(charFile + '.bak', fs.readFileSync(charFile));
    }
    if (fs.existsSync(memFile)) {
      fs.writeFileSync(memFile + '.bak', fs.readFileSync(memFile));
    }

    // 写入导入的数据
    fs.writeFileSync(charFile, JSON.stringify(data.character, null, 2), 'utf-8');
    if (data.memory) {
      fs.writeFileSync(memFile, JSON.stringify(data.memory, null, 2), 'utf-8');
    }

    // 清理备份（导入成功）
    try { if (fs.existsSync(charFile + '.bak')) fs.unlinkSync(charFile + '.bak'); } catch (e) {}
    try { if (fs.existsSync(memFile + '.bak')) fs.unlinkSync(memFile + '.bak'); } catch (e) {}

    await refreshModels();
    modelSelectEl.value = modelName;
    status(`✅ 导入成功！角色"${data.character.name}"的设定与记忆已恢复到"${modelName}"。`);
  } catch (e) {
    // 回滚
    try {
      if (fs.existsSync(charFile + '.bak')) {
        fs.writeFileSync(charFile, fs.readFileSync(charFile + '.bak'));
        fs.unlinkSync(charFile + '.bak');
      }
      if (fs.existsSync(memFile + '.bak')) {
        fs.writeFileSync(memFile, fs.readFileSync(memFile + '.bak'));
        fs.unlinkSync(memFile + '.bak');
      }
    } catch (_) {}
    status(`❌ 导入失败: ${e.message}`);
  }
});

testBtn.addEventListener('click', async () => {
  const apiConfig = {
    provider: providerEl.value,
    apiKey: apikeyEl.value.trim(),
    apiUrl: apiurlEl.value.trim() || defaults[providerEl.value].url,
    model: modelNameEl.value.trim() || defaults[providerEl.value].model,
  };
  if (!apiConfig.apiKey) { status('请先填写 API Key'); return; }
  if (!apiConfig.apiUrl) { status('请先填写 API 地址'); return; }
  status('正在测试连接...');
  testBtn.disabled = true;
  const result = await ipcRenderer.invoke('test-api-connection', apiConfig);
  testBtn.disabled = false;
  if (result.error) {
    status(`❌ ${result.error}`);
  } else {
    status('✅ 连接成功！API 配置有效。');
  }
});

saveBtn.addEventListener('click', async () => {
  const data = {
    provider: providerEl.value, apiKey: apikeyEl.value.trim(),
    apiUrl: apiurlEl.value.trim() || defaults[providerEl.value].url,
    model: modelNameEl.value.trim() || defaults[providerEl.value].model,
    activeModel: modelSelectEl.value,
  };
  if (!data.activeModel) { status('请选择模型或先导入模型'); return; }
  if (!data.apiKey) { status('请输入 API Key'); return; }

  // 保存前先测试连接
  status('正在测试 API 连接...');
  saveBtn.disabled = true;
  const testResult = await ipcRenderer.invoke('test-api-connection', data);
  if (testResult.error) {
    saveBtn.disabled = false;
    status(`❌ 连接失败: ${testResult.error}\n请检查 API 配置后再试。`);
    return;
  }

  status('连接成功，正在保存...');
  await ipcRenderer.invoke('save-settings', data);
  // save-settings 成功后会自动关闭窗口，无需恢复按钮
});

init().catch(e => status('初始化失败: ' + e.message));
