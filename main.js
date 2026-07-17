const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, safeStorage, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const MODELS_DIR = path.join(__dirname, 'models');
const CONFIG_DIR = path.join(__dirname, 'config');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.enc');
const PET_W = 340, PET_H = 360;
let petWindow, setupWindow, tray, modelPort;
let isPetMode = true;
let clickThrough = false;
let activeModel = '';
let settings = null;

// === 设置 ===
function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(SETTINGS_FILE)));
  } catch (e) { return null; }
}
function saveSettings(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, safeStorage.encryptString(JSON.stringify(data)));
  settings = data;
}

// === 模型 ===
function scanModels() {
  if (!fs.existsSync(MODELS_DIR)) return [];
  return fs.readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const dir = path.join(MODELS_DIR, d.name);
      if (!fs.existsSync(path.join(dir, `${d.name}.model3.json`))) return null;
      const charFile = path.join(dir, 'character.json');
      let character = null;
      if (fs.existsSync(charFile)) {
        try { character = JSON.parse(fs.readFileSync(charFile, 'utf-8')); } catch (e) {}
      }
      return { name: d.name, character, path: dir };
    })
    .filter(Boolean);
}

function getModelUrl(name) {
  return `http://127.0.0.1:${modelPort}/${encodeURIComponent(name)}/${encodeURIComponent(name)}.model3.json`;
}

// === 自动生成角色卡 ===
function ensureCharacterCard(modelDir, modelName) {
  const charFile = path.join(modelDir, 'character.json');
  if (fs.existsSync(charFile)) return;
  const card = {
    name: modelName,
    version: '1.0',
    personality: `你是${modelName}。`,
    firstMessage: `你好！我是${modelName}~`,
  };
  fs.writeFileSync(charFile, JSON.stringify(card, null, 2), 'utf-8');
}

// === 自动生成表情引用 ===
function ensureExpressionRefs(modelDir, modelName) {
  const modelJsonPath = path.join(modelDir, `${modelName}.model3.json`);
  if (!fs.existsSync(modelJsonPath)) return;
  const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));
  if (modelJson.FileReferences && modelJson.FileReferences.Expressions) return; // 已有

  const expDir = path.join(modelDir, 'Expressions');
  if (!fs.existsSync(expDir)) return;
  const expFiles = fs.readdirSync(expDir).filter(f => f.endsWith('.exp3.json'));
  if (expFiles.length === 0) return;

  modelJson.FileReferences = modelJson.FileReferences || {};
  modelJson.FileReferences.Expressions = expFiles.map(f => ({
    Name: f.replace('.exp3.json', ''),
    File: `Expressions/${f}`,
  }));
  fs.writeFileSync(modelJsonPath, JSON.stringify(modelJson, null, '\t'), 'utf-8');
}

// === 导入模型 ===
async function importModel() {
  if (!petWindow || petWindow.isDestroyed()) return;

  const result = await dialog.showOpenDialog(petWindow, {
    title: '选择 Live2D 模型文件夹',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) return;

  const srcDir = result.filePaths[0];
  const modelName = path.basename(srcDir);
  const modelFile = path.join(srcDir, `${modelName}.model3.json`);

  // 验证：必须包含 {name}.model3.json
  if (!fs.existsSync(modelFile)) {
    dialog.showErrorBox('导入失败', `文件夹内未找到 "${modelName}.model3.json"\n\nLive2D 模型文件夹必须包含与文件夹同名的 .model3.json 文件。`);
    return;
  }

  // 验证 JSON 格式
  try { JSON.parse(fs.readFileSync(modelFile, 'utf-8')); }
  catch (e) { dialog.showErrorBox('导入失败', `"${modelName}.model3.json" 格式无效：${e.message}`); return; }

  // 验证 .moc3 文件
  const modelJson = JSON.parse(fs.readFileSync(modelFile, 'utf-8'));
  const mocFile = modelJson.FileReferences?.Moc;
  if (!mocFile || !fs.existsSync(path.join(srcDir, mocFile))) {
    dialog.showErrorBox('导入失败', `缺少模型文件 "${mocFile || '未指定'}"，无法加载 Live2D 模型。`);
    return;
  }

  const destDir = path.join(MODELS_DIR, modelName);
  if (fs.existsSync(destDir)) {
    const { response } = await dialog.showMessageBox(petWindow, {
      type: 'question', buttons: ['覆盖', '取消'],
      title: '模型已存在', message: `"${modelName}" 已存在，是否覆盖？`,
    });
    if (response === 1) return;
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  // 复制
  try {
    copyDirSync(srcDir, destDir);

    // 验证复制结果
    if (!fs.existsSync(path.join(destDir, `${modelName}.model3.json`))) {
      throw new Error('复制后验证失败');
    }
  } catch (e) {
    try { if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true }); } catch (_) {}
    dialog.showErrorBox('导入失败', `复制模型文件时出错：${e.message}`);
    return;
  }

  // 自动生成
  ensureCharacterCard(destDir, modelName);
  ensureExpressionRefs(destDir, modelName);

  // 切换到新模型
  activeModel = modelName;
  const sets = loadSettings();
  if (sets) { sets.activeModel = modelName; saveSettings(sets); }
  if (petWindow) petWindow.webContents.send('switch-model', { name: modelName, url: getModelUrl(modelName) });
  updateTrayIcon();
  updateTrayMenu();
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

// === 删除模型 ===
async function deleteModel() {
  const models = scanModels();
  if (models.length === 0) return;
  const { response } = await dialog.showMessageBox(petWindow, {
    type: 'warning', buttons: models.map(m => `删除 ${m.character?.name || m.name}`).concat(['取消']),
    title: '删除模型', message: '选择要删除的模型：',
  });
  if (response >= models.length) return;
  const name = models[response].name;
  fs.rmSync(path.join(MODELS_DIR, name), { recursive: true, force: true });
  if (activeModel === name) {
    const remaining = scanModels();
    activeModel = remaining[0]?.name || '';
    if (petWindow && activeModel) {
      petWindow.webContents.send('switch-model', { name: activeModel, url: getModelUrl(activeModel) });
    }
  }
  updateTrayIcon();
  updateTrayMenu();
}

// === HTTP ===
function startModelServer() {
  return new Promise((resolve, reject) => {
    const mime = { '.json': 'application/json', '.png': 'image/png', '.moc3': 'application/octet-stream',
      '.wasm': 'application/wasm', '.js': 'application/javascript' };
    const srv = http.createServer((req, res) => {
      const fp = path.join(MODELS_DIR, decodeURIComponent(req.url.split('?')[0]));
      if (!fp.startsWith(MODELS_DIR)) { res.writeHead(403); res.end(); return; }
      try {
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
          if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(fs.readdirSync(fp))); return;
          }
          res.writeHead(404); res.end(); return;
        }
        const buf = fs.readFileSync(fp);
        res.setHeader('Content-Type', mime[path.extname(fp).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*'); res.end(buf);
      } catch (e) { res.writeHead(500); res.end(); }
    });
    srv.listen(0, '127.0.0.1', () => { modelPort = srv.address().port; resolve(modelPort); });
    srv.on('error', reject);
  });
}

const webPrefs = { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, nodeIntegration: true, webSecurity: false };

function openSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.focus(); return; }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  setupWindow = new BrowserWindow({
    width: 540, height: 820, x: Math.round((sw - 540) / 2), y: Math.round((sh - 820) / 2),
    transparent: false, frame: true, resizable: false,
    backgroundColor: '#1a1a2e', title: '桌面宠物 - 设置',
    webPreferences: webPrefs,
  });
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWindow.on('closed', () => { setupWindow = null; });
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  petWindow = new BrowserWindow({
    width: PET_W, height: PET_H, x: sw - PET_W - 30, y: sh - PET_H - 10,
    transparent: true, frame: false, alwaysOnTop: true,
    skipTaskbar: false, resizable: false, hasShadow: false,
    backgroundColor: '#00000000', webPreferences: webPrefs,
  });
  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.webContents.on('did-finish-load', () => setTimeout(broadcastSize, 300));
  petWindow.on('resize', () => broadcastSize());
  petWindow.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); petWindow.hide(); } });
}

function broadcastSize() {
  if (!petWindow) return;
  const [w, h] = petWindow.getSize();
  petWindow.webContents.send('resize', { width: w, height: h, titleH: isPetMode ? 0 : 32, isPetMode });
}

function toggleMode() {
  isPetMode = !isPetMode;
  if (isPetMode) { petWindow.setResizable(false); petWindow.setSize(PET_W, PET_H); petWindow.setAlwaysOnTop(true, 'screen-saver'); }
  else {
    if (clickThrough) toggleClickThrough(); // 切到窗口模式自动关闭穿透
    petWindow.setAlwaysOnTop(false); petWindow.setMinimumSize(320, 350); petWindow.setSize(480, 500);
  }
  setTimeout(broadcastSize, 150); updateTrayMenu();
}

function toggleClickThrough() {
  clickThrough = !clickThrough;
  if (clickThrough && !isPetMode) toggleMode(); // 穿透强制进入宠物模式
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setIgnoreMouseEvents(clickThrough);
  }
  if (petWindow) petWindow.webContents.send('click-through-changed', clickThrough);
  updateTrayMenu();
}

function switchModel(name) {
  if (activeModel === name) return;
  activeModel = name;
  const sets = loadSettings();
  if (sets) { sets.activeModel = name; saveSettings(sets); }
  if (petWindow) petWindow.webContents.send('switch-model', { name, url: getModelUrl(name) });
  updateTrayIcon(); updateTrayMenu();
}

// === 托盘 ===
function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const models = scanModels();
  const template = [
    { label: '桌面宠物', enabled: false }, { type: 'separator' },
    { label: '选择模型', submenu: models.length > 0 ? models.map(m => ({
      label: m.character?.name || m.name, type: 'radio', checked: activeModel === m.name,
      click: () => switchModel(m.name),
    })) : [{ label: '（无模型）', enabled: false }]},
    { type: 'separator' },
    { label: '导入模型', click: () => importModel() },
    { type: 'separator' },
    { label: '模式', submenu: [
      { label: '宠物模式', type: 'radio', checked: isPetMode, click: () => { if (!isPetMode) toggleMode(); } },
      { label: '窗口模式', type: 'radio', checked: !isPetMode, click: () => { if (isPetMode) toggleMode(); } },
      { type: 'separator' },
      { label: '鼠标穿透', type: 'checkbox', checked: clickThrough, click: () => toggleClickThrough() },
    ]},
    { type: 'separator' },
    { label: 'API 设置', click: () => openSetupWindow() },
    { label: '显示/隐藏', click: () => petWindow.isVisible() ? petWindow.hide() : petWindow.show() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function getTrayIcon(name) {
  for (const ext of ['.ico', '.png']) {
    const iconPath = path.join(MODELS_DIR, name, 'icon' + ext);
    if (fs.existsSync(iconPath)) return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  for (const ext of ['.ico', '.png']) {
    const defaultPath = path.join(__dirname, 'default-icon' + ext);
    if (fs.existsSync(defaultPath)) return nativeImage.createFromPath(defaultPath).resize({ width: 16, height: 16 });
  }
  return nativeImage.createEmpty();
}

function createTray() {
  tray = new Tray(getTrayIcon(activeModel));
  tray.setToolTip('桌面宠物'); updateTrayMenu();
  tray.on('click', () => petWindow.isVisible() ? petWindow.hide() : petWindow.show());
}

function updateTrayIcon() {
  if (!tray || tray.isDestroyed()) return;
  tray.setImage(getTrayIcon(activeModel));
}

// === IPC ===
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (e, data) => {
  saveSettings(data);
  const oldModel = activeModel;
  activeModel = data.activeModel;
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  else {
    petWindow.webContents.send('settings-updated', data);
    if (data.activeModel && data.activeModel !== oldModel) {
      petWindow.webContents.send('switch-model', { name: data.activeModel, url: getModelUrl(data.activeModel) });
    }
  }
  if (!tray || tray.isDestroyed()) createTray();
  updateTrayMenu(); return true;
});
ipcMain.handle('get-models', () => scanModels());
ipcMain.handle('get-model-url', () => getModelUrl(activeModel));
ipcMain.handle('set-active-model', (e, name) => { activeModel = name; return true; });
ipcMain.handle('toggle-window-mode', () => { toggleMode(); return isPetMode; });
ipcMain.handle('toggle-click-through', () => { toggleClickThrough(); return clickThrough; });
ipcMain.handle('get-click-through', () => clickThrough);
ipcMain.handle('get-window-bounds', () => {
  if (!petWindow) return {};
  const [x, y] = petWindow.getPosition(); const [w, h] = petWindow.getSize();
  return { x, y, width: w, height: h };
});
ipcMain.on('resize-window', (e, bounds) => { if (petWindow) petWindow.setBounds(bounds); });
ipcMain.handle('import-model', async () => {
  try {
    const result = await dialog.showOpenDialog(setupWindow || petWindow, {
      title: '选择 Live2D 模型文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const srcDir = result.filePaths[0];
    const modelName = path.basename(srcDir);
    const modelFile = path.join(srcDir, `${modelName}.model3.json`);

    if (!fs.existsSync(modelFile)) {
      return { error: `文件夹内未找到 "${modelName}.model3.json"\nLive2D 模型必须包含与文件夹同名的 .model3.json 文件。` };
    }

    // 先验证 JSON 合法性
    try { JSON.parse(fs.readFileSync(modelFile, 'utf-8')); }
    catch (e) { return { error: `"${modelName}.model3.json" 格式无效：${e.message}` }; }

    // 检查 .moc3 文件
    const modelJson = JSON.parse(fs.readFileSync(modelFile, 'utf-8'));
    const mocFile = modelJson.FileReferences?.Moc;
    if (!mocFile || !fs.existsSync(path.join(srcDir, mocFile))) {
      return { error: `缺少模型文件 "${mocFile || '未指定'}"` };
    }

    const destDir = path.join(MODELS_DIR, modelName);

    try {
      // 原子操作：先复制到临时目录，成功后再移动
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
      copyDirSync(srcDir, destDir);

      // 验证复制结果
      if (!fs.existsSync(path.join(destDir, `${modelName}.model3.json`))) {
        throw new Error('复制后验证失败');
      }

      ensureCharacterCard(destDir, modelName);
      ensureExpressionRefs(destDir, modelName);

    } catch (e) {
      // 回滚
      try { if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true }); } catch (_) {}
      return { error: `导入失败：${e.message}` };
    }

    // 激活
    activeModel = modelName;
    const sets = loadSettings();
    if (sets) { sets.activeModel = modelName; saveSettings(sets); }
    if (petWindow) petWindow.webContents.send('switch-model', { name: modelName, url: getModelUrl(modelName) });
    updateTrayIcon(); updateTrayMenu();
    return { success: true, name: modelName };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('optimize-character-card', async (e, modelName, userInput) => {
  const modelDir = path.join(MODELS_DIR, modelName);
  const charFile = path.join(modelDir, 'character.json');
  if (!fs.existsSync(charFile)) return { error: '该模型没有角色卡' };

  const current = JSON.parse(fs.readFileSync(charFile, 'utf-8'));
  const settings = loadSettings();
  if (!settings || !settings.apiKey) return { error: '请先配置 API' };

  if (!userInput) return { error: '请提供角色描述' };

  const systemPrompt = `将旧角色卡与用户的新描述融合，生成完整的AI角色卡。这是一个有自我意识的AI，不是宠物或玩具。返回纯JSON：{"name":"...","personality":"...","firstMessage":"..."}。personality用中文500-2000字。只返回JSON。`;
  const userContent = `旧角色卡：${JSON.stringify(current)}\n\n用户新描述：${userInput}`;

  try {
    let body, headers;
    if (settings.provider === 'claude') {
      headers = { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01' };
      body = JSON.stringify({ model: settings.model, max_tokens: 20000, system: systemPrompt, messages: [{ role: 'user', content: userContent }] });
    } else {
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` };
      body = JSON.stringify({ model: settings.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }], max_tokens: 20000, temperature: 0.8 });
    }
    const res = await fetch(settings.apiUrl, { method: 'POST', headers, body });
    if (!res.ok) return { error: `API 错误: HTTP ${res.status}` };
    const data = await res.json();
    const text = settings.provider === 'claude' ? data?.content?.[0]?.text : data?.choices?.[0]?.message?.content;
    if (!text) return { error: 'AI 返回为空' };

    let jsonStr = (text.match(/\{[\s\S]*\}/) || [])[0];
    if (!jsonStr) return { error: 'AI 返回格式无效:\n' + text.slice(0, 200) };

    // 尝试修复不完整 JSON（补全缺失的闭合括号）
    let newCard;
    try {
      newCard = JSON.parse(jsonStr);
    } catch (e) {
      // 尝试补全
      const fixed = jsonStr + '"}';
      try { newCard = JSON.parse(fixed); } catch (e2) {
        // 尝试提取已存在的字段
        try {
          newCard = {
            name: (jsonStr.match(/"name"\s*:\s*"([^"]*)"/) || [])[1] || modelName,
            personality: (jsonStr.match(/"personality"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/) || [])[1] || jsonStr.slice(0, 500),
            firstMessage: (jsonStr.match(/"firstMessage"\s*:\s*"([^"]*)"/) || [])[1] || '你好！',
          };
        } catch (e3) {
          return { error: 'AI 返回的 JSON 无法解析，请重试' };
        }
      }
    }

    newCard.version = '1.0';
    fs.writeFileSync(charFile, JSON.stringify(newCard, null, 2), 'utf-8');
    return { success: true, card: newCard };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('import-charfile', async () => {
  const result = await dialog.showOpenDialog(setupWindow, {
    title: '导入角色卡文件',
    filters: [{ name: '角色卡', extensions: ['json', 'md', 'txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readCharFile(result.filePaths[0]);
});

ipcMain.handle('import-charfiles-multi', async () => {
  const result = await dialog.showOpenDialog(setupWindow, {
    title: '选择多个角色卡文件',
    filters: [{ name: '角色卡', extensions: ['json', 'md', 'txt'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const contents = result.filePaths.map(fp => {
    const name = path.basename(fp);
    const content = readCharFile(fp);
    return `=== ${name} ===\n${content}`;
  });
  return { content: contents.join('\n\n') };
});

function readCharFile(fp) {
  const content = fs.readFileSync(fp, 'utf-8');
  try {
    const j = JSON.parse(content);
    return j.personality || j.character || j.description || JSON.stringify(j, null, 2);
  } catch (e) {
    return content;
  }
}

ipcMain.on('open-setup', () => openSetupWindow());
ipcMain.on('hide-pet', () => { if (petWindow) petWindow.hide(); });
ipcMain.on('quit-app', () => { app.isQuitting = true; app.quit(); });

// === 导出/导入角色卡与记忆 ===
ipcMain.handle('export-character', async (e, modelName, exportData) => {
  if (!setupWindow || setupWindow.isDestroyed()) return null;
  const result = await dialog.showSaveDialog(setupWindow, {
    title: '导出角色卡与记忆',
    defaultPath: `${modelName}-export.json`,
    filters: [{ name: '角色卡导出', extensions: ['json'] }],
  });
  if (result.canceled) return null;
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { error: `写入失败: ${e.message}` };
  }
});

ipcMain.handle('import-character', async () => {
  if (!setupWindow || setupWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(setupWindow, {
    title: '导入角色卡与记忆',
    filters: [{ name: '角色卡导出', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
    if (data.type !== 'desktop-ai-export') {
      return { error: '无效的导出文件格式' };
    }
    if (!data.character || !data.character.name) {
      return { error: '导出文件中缺少角色卡数据' };
    }
    // 规范化 memory 格式（兼容旧版纯数组格式）
    if (data.memory) {
      if (Array.isArray(data.memory)) {
        data.memory = { facts: [], messages: data.memory };
      } else {
        data.memory.facts = data.memory.facts || [];
        data.memory.messages = data.memory.messages || [];
      }
    }
    return { success: true, data };
  } catch (e) {
    return { error: `读取失败: ${e.message}` };
  }
});

ipcMain.handle('confirm-dialog', async (e, title, message) => {
  if (!setupWindow || setupWindow.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(setupWindow, {
    type: 'warning',
    buttons: ['确认', '取消'],
    title,
    message,
  });
  return response === 0;
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });
  await startModelServer();
  settings = loadSettings();
  if (settings && scanModels().length > 0) {
    activeModel = settings.activeModel || scanModels()[0]?.name || '';
    createPetWindow(); createTray();
  } else {
    openSetupWindow();
  }
});
app.on('before-quit', () => { app.isQuitting = true; });
