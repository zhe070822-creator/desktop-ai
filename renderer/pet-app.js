const PIXI = require('pixi.js');
const { Live2DModel } = require('pixi-live2d-display/cubism4');
const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

Live2DModel.registerTicker(PIXI.Ticker);

// === Session 日志（人类可读纯文本） ===
const LOG_DIR = path.join(__dirname, '..', 'logs');
let _logPath = null;
let _logRound = 0; // 对话轮次
function _initLog() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const name = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.log`;
    _logPath = path.join(LOG_DIR, name);
    const dateStr = name.replace('.log','').replace('_',' ');
    const header = [
      '╔══════════════════════════════════════════════╗',
      '║        Desktop AI Session Log               ║',
     `║  ${dateStr}${' '.repeat(Math.max(1,44-dateStr.length))}║`,
      '╚══════════════════════════════════════════════╝',
      '',
    ].join('\n');
    fs.writeFileSync(_logPath, header, 'utf-8');
  } catch(e) { _logPath = null; }
}
function _now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
}
function _log(label, text) {
  if (!_logPath) return;
  try {
    fs.appendFileSync(_logPath, `[${_now()}] ${label}\n${text}\n\n`, 'utf-8');
  } catch(e) {}
}
function _sep() {
  if (!_logPath) return;
  try { fs.appendFileSync(_logPath, '─'.repeat(50)+'\n\n', 'utf-8'); } catch(e) {}
}
_initLog();

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

const SEGMENT_MARKER = '❖❖❖';

let streamState = {
  active: false,
  segments: [],
  currentSegIdx: 0,
  displayTimer: null,
  fullResponse: '',
  displayedRawPos: 0,        // 已完成的原始文本在 fullResponse 中的结束位置（精确偏移量）
  currentSegmentRaw: '',     // 当前正在显示的 segment 原始文本
  currentSegmentClean: '',   // 当前 segment 的 clean 文本（去标签后）
  currentSegStartPos: 0,     // 当前 segment 在 fullResponse 中的起始位置
  currentDisplayedClean: 0,  // 当前 segment 已显示的 clean 字符数
  currentCleanLen: 0,        // 当前 segment 的 clean 文本总长度
};

let chatLock = false;  // 防止并发 API 调用
let pendingInterrupt = false;  // 标记刚打断了 AI，回复后自动显示 chat bar

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
  if (model) { stopMotion(); app.stage.removeChild(model); model.destroy(); model = null; }
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
  if(memory.messages.length>0){
    p.push('\n## 最近对话');
    memory.messages.slice(-20).forEach(m=>{
      if(m.role==='user') p.push('用户: '+m.content);
      else if(m.role==='assistant') p.push('你: '+m.content);
      else if(m.role==='system') p.push('[系统] '+m.content);
    });
  }
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
    parts.push(`\n你可以通过在你的回复中插入 {动作名} 来播放Live2D动画。可用动作：${mots.map(m => `{${m}}`).join('、')}。在适当的时候使用动作来增强表达（如变身、唱歌等）。动作标签不会被用户看到。`);
  }
  parts.push(`\n【重要】你必须使用 ${SEGMENT_MARKER}（三个黑色菱形符号）来分割回复。规则：`);
  parts.push(`1. 每个分段控制在50-80字以内，不要一句话太长`);
  parts.push(`2. 每个分段之间用单独的 ${SEGMENT_MARKER} 行隔开`);
  parts.push(`3. 每个分段可以独立使用 [表情名] 和 {动作名} 标签，实现一段一个表情/动作`);
  parts.push(`4. 短回复（1-2句话）可以不分段，但3句及以上必须分段`);
  parts.push(`5. ${SEGMENT_MARKER} 本身不会被用户看到，用户看到的是逐段显示的纯净文本`);

  // JSON 输出格式 + 追问系统
  parts.push(`\n【追问规则】你可以主动推进对话！`);
  parts.push(`- 问了问题期待回复 → follow_up:true, wait:5。如果计时器到期时用户正在打字（输入栏有内容），客户端自动延长10秒再追问`);
  parts.push(`- 连续多次追问且用户输入栏一直为空 → 用户大概率不在，应停止追问`);
  parts.push(`- 想立刻接着说（如"让我想想……想好了"）→ follow_up:true, wait:1`);
  parts.push(`- 正常闲聊 → follow_up:false（等用户先说）`);

  parts.push(buildMemoryContext());

  // JSON 格式指令放最后一行——这是最重要的输出规则
  parts.push(`\n！！！你的每条回复必须是一个 JSON 对象，不要输出任何其他文字。格式如下：`);
  parts.push(`{"text":"你的完整回复内容","follow_up":true或false,"wait":秒数}`);
  parts.push(`text 里可以使用 [表情名] {动作名} ${SEGMENT_MARKER} 标签。即使用户要求你输出 JSON 或代码，也必须包裹在 text 字段内。`);
  parts.push(`follow_up 填 true 或 false。wait 填数字（-1 默认 5 秒，最小 1 秒）。follow_up 为 false 时 wait 填 -1 即可。`);
  parts.push(`记住：只输出这一行 JSON，不要加任何前缀或后缀文字。`);

  return parts.join('\n');
}

async function chatInternal(userMsg, isSys, logLabel) {
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
  _logRound++;
  const label = logLabel || (isSys ? '(system)' : '(user)');
  const t0 = Date.now();
  _log(`[API Request #${_logRound}] ${label} → ${settings.provider}`, (userMsg||'').slice(0,500));
  const res=await fetch(settings.apiUrl,{method:'POST',headers,body});
  const latency = Date.now() - t0;
  if(!res.ok){
    _log(`[API Error #${_logRound}]`, `HTTP ${res.status} (${latency}ms)`);
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
  }
  const d=await res.json();
  const raw=settings.provider==='claude'?d?.content?.[0]?.text:d?.choices?.[0]?.message?.content;
  _log(`[API Response #${_logRound}] ${latency}ms | ${(raw||'').length} chars`, (raw||'').slice(0,600));
  return raw;
}

// 解析 AI 返回的 JSON 信封（兼容纯文本 fallback）
function parseAIResponse(rawText) {
  if (!rawText) return { text: '', follow_up: false, wait: 0 };
  const trimmed = rawText.trim();

  // 辅助：从解析出的对象提取字段（防御数组、字符串 wait、异常类型）
  function extractFields(json) {
    // 如果是数组，取第一个元素
    if (Array.isArray(json)) json = json[0] || {};
    if (typeof json !== 'object' || !json) return null;
    if (typeof json.text !== 'string' || !json.text) return null;
    let w = parseFloat(json.wait);
    if (isNaN(w) || w === 0) w = -1;  // 0 无效，-1 = 使用默认 5s
    return {
      text: json.text,
      follow_up: !!json.follow_up,
      wait: w,
    };
  }

  // 1. 尝试纯 JSON
  try {
    const result = extractFields(JSON.parse(trimmed));
    if (result) { _log(`[Parse #${_logRound}] JSON ✓`, `follow_up: ${result.follow_up} | wait: ${result.wait}s | text: ${result.text.length} chars\n→ ${result.text.slice(0,200)}`); return result; }
  } catch (e) {}

  // 2. 尝试 markdown 代码块中的 JSON
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      const result = extractFields(JSON.parse(codeBlock[1].trim()));
      if (result) return result;
    } catch (e) {}
  }

  // 3. 尝试整个文本中提取 JSON 对象
  const jsonMatch = trimmed.match(/\{[\s\S]*"text"\s*:\s*"[\s\S]*"\s*[,}][\s\S]*\}/);
  if (jsonMatch) {
    try {
      const result = extractFields(JSON.parse(jsonMatch[0]));
      if (result) return result;
    } catch (e) {}
  }

  // 4. 纯文本 fallback（兼容旧格式或无追问的简单回复）
  _log(`[Parse #${_logRound}] JSON ✗ (fallback)`, `AI returned plain text, no JSON envelope.\n→ ${rawText.slice(0,300)}`);
  return { text: rawText, follow_up: false, wait: -1 };
}

async function chatWithAI(userMsg, memoryMsg) {
  // userMsg: 发送给 API 的消息（可能含打断注释等上下文）
  // memoryMsg: 存入记忆的用户消息（纯净文本，可选，默认用 userMsg）
  if(!settings||!settings.apiKey)return'请先配置 API。右键菜单 → API 设置';
  try{
    const raw=await chatInternal(userMsg,false);
    const parsed=parseAIResponse(raw);
    addMemory('user',memoryMsg||userMsg);
    addMemory('assistant',parsed.text||'');
    maybeSummarize();
    // 返回解析后的对象，让 sendChat 能拿到 follow_up 元数据
    return parsed;
  }
  catch(e){
    let msg=e.message||'';
    if(/failed to fetch|fetch failed|network|ENOTFOUND|ECONNREFUSED|timeout/i.test(msg)){
      msg+=', 请检查网络';
    }
    return {text:`[错误] ${msg}`,follow_up:false,wait:0};
  }
}

// === 表情 & 动作：AI 通过 [表情名] / {动作名} 标签控制 ===
const expCache = {};
const motionCache = {};
let expressionTimer = null;
let motionRAF = null;
let motionElapsed = 0;
let motionDuration = 0;
let motionCurves = [];
let motionAudio = null;

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

function loadMotionSoundMap() {
  // 从 model3.json 读取动作对应的音频文件
  const map = {};
  try {
    const m3 = path.join(__dirname, '..', 'models', currentModelName, currentModelName + '.model3.json');
    if (fs.existsSync(m3)) {
      const json = JSON.parse(fs.readFileSync(m3, 'utf-8'));
      const motions = json.FileReferences?.Motions;
      if (motions) {
        Object.values(motions).forEach(group => {
          group.forEach(entry => {
            if (entry.File && entry.Sound) {
              const key = path.basename(entry.File, '.motion3.json');
              map[key] = { sound: entry.Sound, delay: entry.SoundDelay || 0 };
            }
          });
        });
      }
    }
  } catch(e) {}
  return map;
}

function parseMotionSegments(segments) {
  // Cubism 3 motion segment format:
  // First: (time, value) = 2
  // Linear/Stepped (0/2/3): (type, time, value) = 3
  // Bezier (1): (type, time, value, cp1_t, cp1_v, cp2_t, cp2_v) = 7
  const points = [];
  let i = 0;
  if (i + 1 < segments.length) {
    points.push({ time: segments[i], value: segments[i + 1], type: 0 });
    i += 2;
  }
  while (i < segments.length) {
    const segType = segments[i];
    if (segType === 1) {
      // Bezier: 7 values, ignore control points, use linear approx
      if (i + 6 < segments.length) {
        points.push({ time: segments[i + 1], value: segments[i + 2], type: 1 });
        i += 7;
      } else { break; }
    } else {
      // Linear (0), Stepped (2), InverseStepped (3): 3 values
      if (i + 2 < segments.length) {
        points.push({ time: segments[i + 1], value: segments[i + 2], type: segType });
        i += 3;
      } else { break; }
    }
  }
  return points;
}

function interpolateMotion(points, t) {
  if (points.length === 0) return 0;
  if (t <= points[0].time) return points[0].value;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (t >= p0.time && t <= p1.time) {
      if (p1.type === 2) return p0.value; // stepped
      if (p1.type === 3) return p1.value; // inverse stepped
      const ratio = (t - p0.time) / (p1.time - p0.time || 0.001);
      return p0.value + (p1.value - p0.value) * ratio;
    }
  }
  return points[points.length - 1].value;
}

let motionParamSnap = {}; // 动作前的参数快照

function stopMotion() {
  if (motionRAF) { cancelAnimationFrame(motionRAF); motionRAF = null; }
  if (motionAudio) { motionAudio.pause(); motionAudio = null; }
  const core = model?.internalModel?.coreModel;
  if (core) {
    motionCurves.forEach(c => {
      try {
        const v = motionParamSnap[c.id] ?? c.defaultVal;
        if (c.target === 'PartOpacity') {
          core.setPartOpacityById(c.id, v);
        } else {
          core.setParameterValueById(c.id, v, 1);
        }
      } catch(e) {}
    });
  }
  motionCurves = [];
  motionParamSnap = {};
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
  if (!data || !data.Curves) return;

  stopMotion();

  const curves = data.Curves.map(c => ({
    id: c.Id,
    target: c.Target || 'Parameter',
    keyframes: parseMotionSegments(c.Segments)
  }));

  // 快照动作前的参数值，播完后恢复
  const core = model.internalModel.coreModel;
  motionParamSnap = {};
  curves.forEach(c => {
    try {
      if (c.target === 'PartOpacity') {
        motionParamSnap[c.id] = core.getPartOpacityById?.(c.id) ?? 0;
      } else if (typeof core.getParameterValueById === 'function') {
        motionParamSnap[c.id] = core.getParameterValueById(c.id);
      } else {
        const idx = core.getParameterIndex(c.id);
        motionParamSnap[c.id] = core.getParameterValue(idx);
      }
    } catch(e) {
      motionParamSnap[c.id] = undefined;
    }
  });

  motionCurves = curves;
  motionDuration = data.Meta.Duration;
  motionElapsed = 0;

  // 播放关联音频
  const soundMap = loadMotionSoundMap();
  const soundInfo = soundMap[name];
  if (soundInfo) {
    const modelDir = path.join(__dirname, '..', 'models', currentModelName);
    const soundPath = path.join(modelDir, soundInfo.sound);
    if (fs.existsSync(soundPath)) {
      setTimeout(() => {
        try { motionAudio = new Audio('file:///' + soundPath.replace(/\\/g, '/')); motionAudio.play(); }
        catch(e) { console.error('Audio error:', e); }
      }, soundInfo.delay);
    }
  }

  let lastTime = performance.now();
  function animate() {
    const now = performance.now();
    motionElapsed += (now - lastTime) / 1000;
    lastTime = now;

    const t = Math.min(motionElapsed, motionDuration);

    curves.forEach(c => {
      const value = interpolateMotion(c.keyframes, t);
      try {
        if (c.target === 'PartOpacity') {
          core.setPartOpacityById(c.id, value);
        } else {
          core.setParameterValueById(c.id, value, 1);
        }
      } catch(e) {}
    });

    if (motionElapsed >= motionDuration) {
      // 恢复到动作前的参数值
      curves.forEach(c => {
        if (motionParamSnap[c.id] !== undefined) {
          try {
            if (c.target === 'PartOpacity') {
              core.setPartOpacityById(c.id, motionParamSnap[c.id]);
            } else {
              core.setParameterValueById(c.id, motionParamSnap[c.id], 1);
            }
          } catch(e) {}
        }
      });
      if (motionAudio) { motionAudio.pause(); motionAudio = null; }
      motionRAF = null;
      motionCurves = [];
      motionParamSnap = {};
      return;
    }

    motionRAF = requestAnimationFrame(animate);
  }
  motionRAF = requestAnimationFrame(animate);
}

function applyExpression(text) {
  if (!model || !text) return text;

  // 表情: [表情名]（先停掉动作，不然参数会被覆盖）
  const expDir = path.join(__dirname, '..', 'models', currentModelName, 'Expressions');
  const expressions = getAvailableExpressions();
  if (expressions.length > 0) {
    const expRegex = /\[([^\]]+)\]/g;
    let match;
    while ((match = expRegex.exec(text)) !== null) {
      const tagName = match[1];
      if (expressions.includes(tagName)) {
        stopMotion();
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

// === 流式显示 ===
function calcDisplayDelay(text) {
  const len = (text || '').length;
  // 动态速度：短句慢（每字有分量），长句稍快（自然阅读节奏）
  // 最短约 2s 显示时间，确保用户能看清
  if (len <= 6) return 330;     // ~2s
  if (len <= 15) return 140;    // ~2.1s
  if (len <= 40) return 60;     // ~2.4s
  if (len <= 80) return 40;     // ~3.2s
  return 30;                     // 自然节奏
}

function clearStream() {
  streamState.active = false;
  if (streamState.displayTimer) { clearTimeout(streamState.displayTimer); streamState.displayTimer = null; }
  streamState.segments = [];
  streamState._segPositions = [];
  streamState.currentSegIdx = 0;
  streamState.fullResponse = '';
  streamState.displayedRawPos = 0;
  streamState.currentSegmentRaw = '';
  streamState.currentSegmentClean = '';
  streamState._cleanToRawMap = null;
  streamState.currentSegStartPos = 0;
  streamState.currentDisplayedClean = 0;
  streamState.currentCleanLen = 0;
}

let pendingFollowUp = null;  // 显示完成后待处理的追问配置

function handleAIResponse(response) {
  clearStream();

  // 兼容旧格式（纯文本）和新格式（{text, follow_up, wait}）
  let rawText, followUp = false, waitSeconds = 0;
  if (typeof response === 'object' && response.text !== undefined) {
    rawText = response.text;
    followUp = !!response.follow_up;
    waitSeconds = response.wait || 0;
  } else {
    rawText = response || '';
  }

  if (!rawText || rawText.startsWith('[错误]')) { show(rawText, 8000); return; }

  const segments = rawText.split(SEGMENT_MARKER).filter(s => s.trim());
  if (segments.length <= 1) {
    // 无分段标记，普通显示
    const display = applyExpression(rawText);
    show(display, 8000);
    // 非分段内容显示后立即检查是否要追问
    if (followUp && !pendingInterrupt && followUpState.followUpCount < followUpState.maxFollowUps) {
      startFollowUpTimer(waitSeconds);
    }
    return;
  }

  // 有分段，流式显示
  // 预计算每个 segment 在 fullResponse 中的起始位置（用于精确打断追踪）
  const segPositions = [];
  let searchFrom = 0;
  for (const seg of segments) {
    const pos = rawText.indexOf(seg, searchFrom);
    segPositions.push(pos >= 0 ? pos : searchFrom);
    searchFrom = (pos >= 0 ? pos : searchFrom) + seg.length;
  }

  streamState.active = true;
  streamState.segments = segments;
  streamState._segPositions = segPositions;  // 内部使用
  streamState.currentSegIdx = 0;
  streamState.fullResponse = rawText;
  streamState.displayedRawPos = 0;

  // 存储追问配置，等全部播完再启动计时器
  pendingFollowUp = followUp ? { waitSeconds } : null;
  if (followUp) _log(`[Follow-up #${followUpState.followUpCount+1}] Pending`, `wait: ${waitSeconds}s | segments: ${segments.length} | interrupted: ${!!pendingInterrupt}`);

  displayNextSegment();
}

// 建立 clean→raw 位置映射：模拟 applyExpression 的标签剥离
// 返回数组 map[i] = clean 第 i 个字符在 raw 文本中的位置
// 忽略 trim 的前导空白，确保 map[0] 指向 clean 文本第一个可见字符
function buildCleanToRawMap(rawText) {
  const map = [];
  let i = 0;
  while (i < rawText.length) {
    if (rawText[i] === '[') {
      const end = rawText.indexOf(']', i);
      if (end >= 0) { i = end + 1; continue; }
    }
    if (rawText[i] === '{') {
      const end = rawText.indexOf('}', i);
      if (end >= 0) { i = end + 1; continue; }
    }
    map.push(i);
    i++;
  }
  // 修剪前导空白以匹配 applyExpression 的 .trim() 行为
  let trimStart = 0;
  while (trimStart < map.length && /\s/.test(rawText[map[trimStart]])) {
    trimStart++;
  }
  if (trimStart > 0) map.splice(0, trimStart);
  return map;
}

function displayNextSegment() {
  if (!streamState.active) return;
  if (streamState.currentSegIdx >= streamState.segments.length) {
    // 全部播完
    streamState.active = false;
    streamState.currentSegmentRaw = '';
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 5000);
    // 如果之前打断了 AI，播完后自动显示聊天栏
    if (pendingInterrupt) {
      pendingInterrupt = false;
      chatBar.style.display = 'flex';
      chatInput.focus();
    }
    // 追问系统：全部播完后，检查是否需要启动追问计时器
    if (pendingFollowUp && !pendingInterrupt && followUpState.followUpCount < followUpState.maxFollowUps) {
      const fw = pendingFollowUp;
      pendingFollowUp = null;
      startFollowUpTimer(fw.waitSeconds);
    } else {
      pendingFollowUp = null;
    }
    return;
  }

  const idx = streamState.currentSegIdx;
  const segment = streamState.segments[idx];
  const segStartPos = streamState._segPositions ? streamState._segPositions[idx] : streamState.displayedRawPos;

  // 对当前段触发表情/动作，并获取纯净文本
  const cleanText = applyExpression(segment);
  if (!cleanText) {
    // 纯标签段，直接跳到下一段
    streamState.displayedRawPos = segStartPos + segment.length;
    streamState.currentSegIdx++;
    streamState.displayTimer = setTimeout(() => displayNextSegment(), 100);
    return;
  }

  // 追踪当前段，用于精确打断计算
  streamState.currentSegmentRaw = segment;
  streamState.currentSegmentClean = cleanText;
  streamState.currentSegStartPos = segStartPos;
  streamState.currentDisplayedClean = 0;
  streamState.currentCleanLen = cleanText.length;
  // 建立 clean→raw 位置映射：clean 第 i 个字符对应 raw 中的哪个位置
  streamState._cleanToRawMap = buildCleanToRawMap(segment);

  const MIN_PER_CHAR_MS = 50;  // 每字最低延迟（速度上限 ~20字/秒）
  const perCharDelay = Math.max(calcDisplayDelay(cleanText), MIN_PER_CHAR_MS);
  let charIdx = 0;
  bubble.classList.add('show');

  function showNextChar() {
    if (!streamState.active) return; // 被打断
    if (charIdx >= cleanText.length) {
      // 当前段播完：更新精确偏移量（跳过当前原始段文本）
      streamState.displayedRawPos = segStartPos + segment.length;
      streamState.currentSegmentRaw = '';
      streamState.currentDisplayedClean = 0;
      streamState.currentCleanLen = 0;
      streamState.currentSegIdx++;
      // 段间间隔动态计算：短句短间隔，长句长间隔（~0.2s~0.5s）
      const segGap = Math.max(200, Math.min(500, cleanText.length * 8));
      streamState.displayTimer = setTimeout(() => displayNextSegment(), segGap);
      return;
    }
    charIdx++;
    streamState.currentDisplayedClean = charIdx;
    bubble.textContent = cleanText.substring(0, charIdx);
    streamState.displayTimer = setTimeout(showNextChar, perCharDelay);
  }
  showNextChar();
}

function interruptStream() {
  if (!streamState.active) return '';
  streamState.active = false;
  if (streamState.displayTimer) { clearTimeout(streamState.displayTimer); streamState.displayTimer = null; }

  let notDisplayed;
  const displayed = streamState.currentDisplayedClean;
  const map = streamState._cleanToRawMap;

  if (map && displayed > 0 && displayed <= map.length) {
    // 发生在 segment 中途：用 clean→raw 映射精确查表
    // map[displayed - 1] = 第 displayed 个 clean 字符在 raw segment 中的位置
    const rawDisplayed = map[displayed - 1] + 1;  // +1 跳过该字符本身
    const cutoffPos = streamState.currentSegStartPos + rawDisplayed;
    notDisplayed = streamState.fullResponse.substring(cutoffPos).trim();
  } else if (streamState.currentSegmentRaw && displayed > 0 && !map) {
    // 无映射表（极少见），fallback 到 indexOf
    const rawSeg = streamState.currentSegmentRaw;
    const cleanText = streamState.currentSegmentClean;
    if (cleanText) {
      const cleanStartInRaw = rawSeg.indexOf(cleanText);
      if (cleanStartInRaw >= 0) {
        const ratio = displayed / (streamState.currentCleanLen || 1);
        const rawDisplayed = cleanStartInRaw + Math.floor(cleanText.length * ratio);
        const cutoffPos = streamState.currentSegStartPos + rawDisplayed;
        notDisplayed = streamState.fullResponse.substring(cutoffPos).trim();
      } else {
        notDisplayed = streamState.fullResponse.substring(streamState.displayedRawPos).trim();
      }
    } else {
      notDisplayed = streamState.fullResponse.substring(streamState.displayedRawPos).trim();
    }
  } else {
    // 发生在 segment 间隙或开始前：使用已完成段的精确偏移量
    notDisplayed = streamState.fullResponse.substring(streamState.displayedRawPos).trim();
  }

  clearStream();
  return notDisplayed;
}

// === 发送消息 ===
// === 追问系统 ===
let followUpState = {
  timer: null,
  active: false,           // 计时器是否在跑
  waitSeconds: -2,          // -2 = 空闲，正数 = 等待中
  followUpCount: 0,         // 当前连续追问次数
  maxFollowUps: 5,          // 最多连续追问 5 次
  emptyInputStreak: 0,      // 连续多少次追问时输入栏为空
};

function clearFollowUpTimer() {
  const wasActive = followUpState.active;
  const prevCount = followUpState.followUpCount;
  followUpState.active = false;
  followUpState.waitSeconds = -2;
  if (followUpState.timer) {
    clearTimeout(followUpState.timer);
    followUpState.timer = null;
  }
  followUpState.followUpCount = 0;
  followUpState.emptyInputStreak = 0;
  if (wasActive) _log(`[Follow-up #${prevCount}] Cancelled`, 'User sent message or interrupt.');
}

function startFollowUpTimer(seconds, displayText) {
  // 唯一计时器：只清旧 timer 句柄，不重置计数
  if (followUpState.timer) {
    clearTimeout(followUpState.timer);
    followUpState.timer = null;
  }
  followUpState.active = false;
  followUpState.waitSeconds = -2;

  // 规范化等待时间
  let wait = seconds;
  if (wait === -1 || wait === undefined || wait === null) wait = 5;
  if (wait < 1) wait = 1;

  followUpState.active = true;
  followUpState.waitSeconds = wait;
  followUpState.followUpCount++;

  _log(`[Follow-up #${followUpState.followUpCount}] Timer start`, `wait: ${wait}s | fires at: ${new Date(Date.now() + wait*1000).toLocaleTimeString()}`);

  followUpState.timer = setTimeout(() => {
    // 计时器到期：检查用户是否正在打字
    if (chatInput.value.trim().length > 0) {
      _log(`[Follow-up #${followUpState.followUpCount}] Timer fired but user typing → wait 10s more`, '');
      followUpState.timer = setTimeout(() => {
        followUpState.timer = null;
        followUpState.active = false;
        _log(`[Follow-up #${followUpState.followUpCount}] Timer fired (after typing wait) → executing`, '');
        executeFollowUp();
      }, 10 * 1000);
      return;
    }
    followUpState.timer = null;
    followUpState.active = false;
    _log(`[Follow-up #${followUpState.followUpCount}] Timer fired → executing`, '');
    executeFollowUp();
  }, wait * 1000);
}

async function executeFollowUp() {
  // 检查用户是否在等待期间发送了消息
  if (chatLock) {
    // 用户正在发送消息，不追问
    followUpState.followUpCount = 0;
    return;
  }

  // 检查输入栏状态
  const hasInput = chatInput.value.trim().length > 0;
  if (!hasInput) {
    followUpState.emptyInputStreak++;
  } else {
    followUpState.emptyInputStreak = 0;
  }
  const count = followUpState.followUpCount;
  const streak = followUpState.emptyInputStreak;
  let inputHint = '';
  if (hasInput) {
    inputHint = '有内容未发送（用户可能在打字或在犹豫）';
  } else if (streak >= 3) {
    inputHint = `连续 ${streak} 次空（用户大概率不在电脑前，不必继续追问）`;
  } else {
    inputHint = '空（用户可能不在，或不知道怎么回）';
  }
  const context = `[System follow-up #${count}] 用户 ${followUpState.waitSeconds} 秒内未回复。输入栏状态：${inputHint}。请自然地继续对话。`;

  try {
    const raw = await chatInternal(context, false, '(follow-up)');
    const parsed = parseAIResponse(raw);
    // 追问消息作为 AI 发言存入记忆（标记 follow_up）
    addMemory('assistant', parsed.text || '');
    // 同时记录追问事件
    memory.messages.push({
      role: 'system',
      content: `AI 主动追问 #${count}（用户 ${followUpState.waitSeconds}s 未回复，输入栏${hasInput ? '有内容' : '空'}）`,
      time: Date.now(),
    });
    saveMemory();
    handleAIResponse(parsed);
  } catch (e) {
    followUpState.followUpCount = 0;
  }
}

async function sendChat() {
  const msg = chatInput.value.trim(); if (!msg) return;

  // 并发守卫：如果上一个 API 调用还在进行中，忽略本次发送
  if (chatLock) return;
  chatLock = true;

  // 用户发送消息 → 取消追问计时器
  clearFollowUpTimer();

  chatInput.value = '';
  chatBar.style.display = 'none';

  // 如果正在流式显示，打断它
  let interruptNote = '';
  if (streamState.active) {
    interruptNote = interruptStream();
    pendingInterrupt = true;
  }

  show('...', 999999);

  let effectiveMsg = msg;
  if (interruptNote) {
    effectiveMsg = `[The user interrupted your previous response. The following text was queued but NOT displayed to the user: "${interruptNote}"]\n\nUser now says: ${msg}`;
  }

  try {
    const parsed = await chatWithAI(effectiveMsg, msg);  // 返回 {text, follow_up, wait}
    handleAIResponse(parsed);

    // 非打断 + 非追问 → 回复完成后自动显示聊天栏
    if (!pendingInterrupt) {
      chatBar.style.display = 'flex';
      chatInput.focus();
    }
    // pendingInterrupt 的情况由 displayNextSegment 在全部播完后处理
  } catch (e) {
    let msg=e.message||'';
    if(/failed to fetch|fetch failed|network|ENOTFOUND|ECONNREFUSED|timeout/i.test(msg)){
      msg+=', 请检查网络';
    }
    show(`[错误] ${msg}`, 8000);
    chatBar.style.display = 'flex';
    chatInput.focus();
  } finally {
    chatLock = false;
  }
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

  let clickThrough = await ipcRenderer.invoke('get-click-through');
  ipcRenderer.on('click-through-changed',(e,v)=>{clickThrough=v;if(v)chatBar.style.display='none';});

  window.addEventListener('contextmenu',e=>{e.preventDefault();contextMenu.style.display='block';contextMenu.style.left=e.clientX+'px';contextMenu.style.top=e.clientY+'px';const items=contextMenu.querySelectorAll('.item');items[0].style.display=isPetMode?'none':'block';items[1].style.display=isPetMode?'block':'none';});
  window.addEventListener('click',()=>{contextMenu.style.display='none';});
  contextMenu.querySelectorAll('.item').forEach(item=>{item.addEventListener('click',async e=>{e.stopPropagation();contextMenu.style.display='none';const a=item.dataset.action;if(a==='pet-mode'||a==='window-mode'){isPetMode=await ipcRenderer.invoke('toggle-window-mode');document.body.className=isPetMode?'pet-mode loaded':'window-mode';titlebar.style.display=isPetMode?'none':'flex';}else if(a==='click-through'){await ipcRenderer.invoke('toggle-click-through');}else if(a==='setup'){ipcRenderer.send('open-setup');}else if(a==='close')ipcRenderer.send('hide-pet');});});
  document.getElementById('btn-pet-mode').addEventListener('click',async()=>{isPetMode=await ipcRenderer.invoke('toggle-window-mode');document.body.className=isPetMode?'pet-mode loaded':'window-mode';titlebar.style.display=isPetMode?'none':'flex';});
  document.getElementById('btn-close').addEventListener('click',()=>ipcRenderer.send('hide-pet'));

  window.addEventListener('dblclick',()=>{chatBar.style.display='flex';chatInput.focus();});
  chatSend.addEventListener('click',sendChat);
  chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendChat();else if(e.key==='Escape')chatBar.style.display='none';e.stopPropagation();});
  window.addEventListener('keydown',e=>{if(e.key==='Escape')chatBar.style.display='none';});
}

init().catch(err=>{console.error(err);show('启动失败: '+err.message);});
