const { ipcRenderer } = require('electron');

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
  const result = await ipcRenderer.invoke('optimize-character-card', modelName, userInput);
  optimizeBtn.disabled = false;
  checkOptimizeInput();
  if (result.error) { status(`优化失败: ${result.error}`); return; }
  status('角色卡已优化！');
  await refreshModels();
  modelSelectEl.value = modelName;
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
  status('保存中...');
  await ipcRenderer.invoke('save-settings', data);
});

init().catch(e => status('初始化失败: ' + e.message));
