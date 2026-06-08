const PIXI = require('pixi.js');
const { Live2DModel, CubismMotion } = require('pixi-live2d-display/cubism4');
const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

Live2DModel.registerTicker(PIXI.Ticker);

const canvas = document.getElementById('canvas');
const bubble = document.getElementById('bubble');
const contextMenu = document.getElementById('context-menu');
const titlebar = document.getElementById('titlebar');
const chatBar = document.getElementById('chat');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');

let app, model, isPetMode = true, settings = null;
let character = null, memory = { facts: [], messages: [] }, memoryPath = '';
let currentModelName = '';

let bubbleTimer = null;
function show(msg, ms) {
  clearTimeout(bubbleTimer); bubble.textContent = msg; bubble.classList.add('show');
  if (ms) bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

function fitModel() {
  if (!model) return;
  model.scale.set(1);
  const scale = Math.min(canvas.width/model.width*0.92, canvas.height/model.height*0.92);
  model.scale.set(scale); model.x = canvas.width/2; model.y = canvas.height/2;
  model.anchor.set(0.5, 0.5);
}

async function loadModel(name, url) {
  currentModelName = name;
  if (model) { app.stage.removeChild(model); model.destroy(); model = null; }
  Object.keys(expCache).forEach(k => delete expCache[k]);
  Object.keys(motionCache).forEach(k => delete motionCache[k]);
  show('加载模型...');
  try { model = await Live2DModel.from(url, { autoInteract: false }); }
  catch (e) { show('模型加载失败: '+e.message); return; }
  app.stage.addChild(model); fitModel();
  document.body.classList.add('loaded');

  // 去水印
  try {
    const core = model.internalModel.coreModel;
    try { core.setPartOpacityById('Part19', 0); } catch(e) {}
    try { core.setPartOpacityById('Part20', 0); } catch(e) {}
    try { core.setParameterValueById('key12', 0, 1); } catch(e) {}
  } catch(e) {}

  const modelDir = path.join(__dirname, '..', 'models', name);
  memoryPath = path.join(modelDir, 'memory.json');
  const charFile = path.join(modelDir, 'character.json');
  if (!fs.existsSync(charFile)) {
    try { fs.writeFileSync(charFile, JSON.stringify({ name, version: '1.0', personality: `你是${name}。`, firstMessage: '你好！' }, null, 2), 'utf-8'); } catch(e) {}
  }
  try { character = JSON.parse(fs.readFileSync(charFile, 'utf-8')); } catch(e) {
    character = { name, personality: `你是${name}。`, firstMessage: '你好！' };
  }
  memory = { facts: [], messages: [] }; loadMemory();
  document.querySelector('#titlebar span').textContent = character?.name || name;
  show(character?.firstMessage || `${name}来了~`, 3000);
}

// === 记忆 ===
function loadMemory() {
  try { if(fs.existsSync(memoryPath)) { const r=JSON.parse(fs.readFileSync(memoryPath,'utf-8')); memory=r.facts?r:{facts:[],messages:r}; } }
  catch(e){ memory={facts:[],messages:[]}; }
}
function saveMemory() {
  try { if(memory.messages.length>50)memory.messages=memory.messages.slice(-50); if(memory.facts.length>50)memory.facts=memory.facts.slice(-50); fs.writeFileSync(memoryPath,JSON.stringify(memory,null,2),'utf-8'); } catch(e){}
}
function addMemory(role, content) { memory.messages.push({role,content,time:Date.now()}); saveMemory(); }

function buildMemoryContext() {
  const p = [];
  if(memory.facts.length>0){ p.push('## 你对用户的了解'); memory.facts.forEach(f=>p.push('- '+f.content)); }
  if(memory.messages.length>0){ p.push('\n## 最近对话'); memory.messages.slice(-20).forEach(m=>p.push((m.role==='user'?'用户':'你')+': '+m.content)); }
  return p.join('\n');
}

async function maybeSummarize() {
  if(memory.messages.length<40||!settings||!settings.apiKey)return;
  const msgs=memory.messages.slice(-40).map(m=>(m.role==='user'?'用户':'AI')+': '+m.content).join('\n');
  const existing=memory.facts.map(f=>f.content).join('\n');
  try {
    const reply=await chatInternal(`请从以下对话提取关于用户的新关键信息（不要重复已有）。没有就答"无"。\n已有：${existing||'(无)'}\n对话：${msgs}\n用- 开头列出新信息。`,true);
    if(reply&&reply!=='无'&&!reply.startsWith('[错误')) {
      reply.split('\n').filter(l=>l.trim().startsWith('-')).forEach(l=>{
        const f=l.replace(/^-\s*/,'').trim();
        if(f.length>2&&!memory.facts.some(x=>x.content===f))memory.facts.push({content:f,time:Date.now()});
      });
      saveMemory();
    }
  }catch(e){/*静默*/}
}

// === AI ===
function getAvailableExpressions() {
  const expDir = path.join(__dirname, '..', 'models', currentModelName, 'Expressions');
  try {
    if (fs.existsSync(expDir)) {
      return fs.readdirSync(expDir).filter(f => f.endsWith('.exp3.json')).map(f => f.replace('.exp3.json', ''));
    }
  } catch(e) {}
  return [];
}

function buildSystemPrompt() {
  const parts = [character?.personality || '你是一个桌面助手。'];
  const exps = getAvailableExpressions();
  if (exps.length > 0) {
    parts.push(`\n你可以通过在你的回复中插入 [表情名] 来切换Live2D表情。可用表情：${exps.map(e => `[${e}]`).join('、')}。在适当的时候使用表情来增强表达。表情标签不会被用户看到。`);
  }
  const mots = getAvailableMotions();
  if (mots.length > 0) {
    parts.push(`\n你可以通过在你的回复中插入 {动作名} 来播放Live2D动画。可用动作：${mots.map(m => `{${m}}`).join('、')}。在适当的时候使用动作来增强表达（如变身、睡觉等）。动作标签不会被用户看到。`);
  }
  parts.push(buildMemoryContext());
  return parts.join('\n');
}

async function chatInternal(userMsg, isSys) {
  const sys=isSys?userMsg:buildSystemPrompt();
  const msgs=isSys?[{role:'user',content:'请回复'}]:[{role:'user',content:userMsg}];
  let body,headers;
  if(settings.provider==='claude'){
    headers={'Content-Type':'application/json','x-api-key':settings.apiKey,'anthropic-version':'2023-06-01'};
    body=JSON.stringify({model:settings.model,max_tokens:isSys?1024:512,system:sys,messages:msgs});
  }else{
    headers={'Content-Type':'application/json','Authorization':`Bearer ${settings.apiKey}`};
    body=JSON.stringify({model:settings.model,messages:[{role:'system',content:sys},...msgs],max_tokens:isSys?1024:512,temperature:isSys?0.3:0.8});
  }
  const res=await fetch(settings.apiUrl,{method:'POST',headers,body});
  if(!res.ok)throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
  const d=await res.json();
  return settings.provider==='claude'?d?.content?.[0]?.text:d?.choices?.[0]?.message?.content;
}

async function chatWithAI(userMsg) {
  if(!settings||!settings.apiKey)return'请先配置 API。右键菜单 → API 设置';
  try{const r=await chatInternal(userMsg,false);addMemory('user',userMsg);addMemory('assistant',r||'');maybeSummarize();const display=applyExpression(r);return display||'(无回复)';}
  catch(e){return`[错误] ${e.message}`;}
}

// === 表情 & 动作：AI 通过 [表情名] / {动作名} 标签控制 ===
const expCache = {};
const motionCache = {};
let expressionTimer = null;

function getAvailableMotions() {
  if (!currentModelName) return [];
  const motionsDir = path.join(__dirname, '..', 'models', currentModelName, 'Motions');
  try {
    if (fs.existsSync(motionsDir)) {
      return fs.readdirSync(motionsDir).filter(f => f.endsWith('.motion3.json')).map(f => f.replace('.motion3.json', ''));
    }
  } catch(e) {}
  return [];
}

function playMotion(name) {
  if (!model) return;
  const motionsDir = path.join(__dirname, '..', 'models', currentModelName, 'Motions');
  if (!motionCache[name]) {
    const motionFile = path.join(motionsDir, name + '.motion3.json');
    try { motionCache[name] = JSON.parse(fs.readFileSync(motionFile, 'utf-8')); }
    catch(e) { motionCache[name] = null; return; }
  }
  const data = motionCache[name];
  if (!data) return;
  try {
    const motion = CubismMotion.create(data);
    model.internalModel.motionManager.queueManager.stopAllMotions();
    model.internalModel.motionManager.queueManager.startMotion(motion, false, performance.now());
  } catch(e) { console.error('Motion error:', e); }
}

function applyExpression(text) {
  if (!model || !text) return text;

  // 表情: [表情名]
  const expDir = path.join(__dirname, '..', 'models', currentModelName, 'Expressions');
  const expressions = getAvailableExpressions();
  if (expressions.length > 0) {
    const expRegex = /\[([^\]]+)\]/g;
    let match;
    while ((match = expRegex.exec(text)) !== null) {
      const tagName = match[1];
      if (expressions.includes(tagName)) {
        if (!expCache[tagName]) {
          const expFile = path.join(expDir, tagName + '.exp3.json');
          try { expCache[tagName] = JSON.parse(fs.readFileSync(expFile, 'utf-8')); }
          catch(e) { expCache[tagName] = null; }
        }
        const exp = expCache[tagName];
        if (exp && exp.Parameters) {
          const core = model.internalModel.coreModel;
          exp.Parameters.forEach(p => {
            try { core.setParameterValueById(p.Id, p.Value, 1); } catch(e) {}
          });
          clearTimeout(expressionTimer);
          expressionTimer = setTimeout(() => {
            exp.Parameters.forEach(p => {
              try { core.setParameterValueById(p.Id, 0, 1); } catch(e) {}
            });
          }, 10000);
        }
      }
    }
  }

  // 动作: {动作名}
  const motions = getAvailableMotions();
  if (motions.length > 0) {
    const motRegex = /\{([^}]+)\}/g;
    let match;
    while ((match = motRegex.exec(text)) !== null) {
      if (motions.includes(match[1])) {
        playMotion(match[1]);
        break; // 一次只播一个动作
      }
    }
  }

  // 移除所有标签，返回纯文本
  return text.replace(/\[([^\]]+)\]/g, '').replace(/\{([^}]+)\}/g, '').trim();
}

function sendChat() {
  const msg=chatInput.value.trim();if(!msg)return;
  chatInput.value='';chatBar.style.display='none';show('...',999999);
  chatWithAI(msg).then(r=>show(r,8000));
}

// === 初始化 ===
async function init() {
  settings = await ipcRenderer.invoke('get-settings');
  if (!settings) { show('未配置，请通过托盘菜单 → API 设置'); document.body.className = 'window-mode'; titlebar.style.display = 'flex'; return; }

  const modelUrl = await ipcRenderer.invoke('get-model-url');
  app = new PIXI.Application({ view:canvas, width:320, height:360, backgroundAlpha:0, antialias:true, resolution:1, autoDensity:false });
  if(typeof Live2DCubismCore==='undefined'){show('CubismCore加载失败');return;}
  await loadModel(settings.activeModel, modelUrl);

  ipcRenderer.on('resize',(e,{width,height,titleH,isPetMode:pm})=>{
    if(width&&height){const cw=width,ch=height-(titleH||0);if(cw>0&&ch>0){canvas.width=cw;canvas.height=ch;canvas.style.width=cw+'px';canvas.style.height=ch+'px';if(app)app.renderer.resize(cw,ch);fitModel();}}
    if(pm!==undefined){isPetMode=pm;document.body.className=pm?'pet-mode loaded':'window-mode';titlebar.style.display=pm?'none':'flex';}
  });
  ipcRenderer.on('switch-model',(e,{name,url})=>loadModel(name,url));
  ipcRenderer.on('settings-updated',(e,data)=>{settings=data;});

  let r=false,re='',rs={};
  document.querySelectorAll('.resize-handle').forEach(h=>{h.addEventListener('mousedown',async e=>{if(isPetMode)return;r=true;const m={top:'n',bottom:'s',left:'w',right:'e',tl:'nw',tr:'ne',bl:'sw',br:'se'};re=m[h.id.replace('rh-','')]||'';const b=await ipcRenderer.invoke('get-window-bounds');rs={...b,mouseX:e.screenX,mouseY:e.screenY};e.preventDefault();e.stopPropagation();});});
  window.addEventListener('mousemove',e=>{if(!r)return;const b={...rs},dx=e.screenX-rs.mouseX,dy=e.screenY-rs.mouseY;if(re.includes('e'))b.width=Math.max(320,b.width+dx);if(re.includes('w')){b.width=Math.max(320,b.width-dx);b.x+=dx;}if(re.includes('s'))b.height=Math.max(350,b.height+dy);if(re.includes('n')){b.height=Math.max(350,b.height-dy);b.y+=dy;}ipcRenderer.send('resize-window',b);});
  window.addEventListener('mouseup',()=>{r=false;});

  window.addEventListener('contextmenu',e=>{e.preventDefault();contextMenu.style.display='block';contextMenu.style.left=e.clientX+'px';contextMenu.style.top=e.clientY+'px';const items=contextMenu.querySelectorAll('.item');items[0].style.display=isPetMode?'none':'block';items[1].style.display=isPetMode?'block':'none';});
  window.addEventListener('click',()=>{contextMenu.style.display='none';});
  contextMenu.querySelectorAll('.item').forEach(item=>{item.addEventListener('click',async e=>{e.stopPropagation();contextMenu.style.display='none';const a=item.dataset.action;if(a==='pet-mode'||a==='window-mode'){isPetMode=await ipcRenderer.invoke('toggle-window-mode');document.body.className=isPetMode?'pet-mode loaded':'window-mode';titlebar.style.display=isPetMode?'none':'flex';}else if(a==='setup'){ipcRenderer.send('open-setup');}else if(a==='close')ipcRenderer.send('hide-pet');});});
  document.getElementById('btn-pet-mode').addEventListener('click',async()=>{isPetMode=await ipcRenderer.invoke('toggle-window-mode');document.body.className=isPetMode?'pet-mode loaded':'window-mode';titlebar.style.display=isPetMode?'none':'flex';});
  document.getElementById('btn-close').addEventListener('click',()=>ipcRenderer.send('hide-pet'));

  window.addEventListener('dblclick',()=>{chatBar.style.display='flex';chatInput.focus();});
  chatSend.addEventListener('click',sendChat);
  chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendChat();else if(e.key==='Escape')chatBar.style.display='none';e.stopPropagation();});
  window.addEventListener('keydown',e=>{if(e.key==='Escape')chatBar.style.display='none';});
}

init().catch(err=>{console.error(err);show('启动失败: '+err.message);});
