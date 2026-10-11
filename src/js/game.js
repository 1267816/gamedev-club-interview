/* ============================================================
   game.js
   只做四件事:1 保存状态 → 2 推进时间 → 3 渲染 → 4 响应命令。
   所有内容(文字/数值/命令)都在 game-data.js,这里只读它。
   ============================================================ */

const D = GAME_DATA;

/* ---------- 1. 状态:所有会变的东西都在这一个对象里 ---------- */
const game = {
  material: 0,          // 材料
  probes:   1,          // 探测器数量
  timeSec:  0,          // 游戏内经过的秒数
  lastTick: Date.now(), // 上一次推进的真实时刻
  commandsRun: 0,       // 已执行命令数(剧情触发用)
  fired:    [],         // 已触发的剧情节点 id(剧情 / 引导见 game-data.js 的 story)
  importantLog: [],     // 重要消息(剧情 / 系统提示),存档时一并保存
  logHistory: [],       // 终端日志历史,刷新后原样恢复
};

// 启动序列是否已打完(P1 引导、引导提示都要等它结束)
let bootDone = false;

// 游戏是否在运行:封面、未开始时不流动
let running = false;

// 由状态"算出来"的值,不存起来,每次现算,避免前后不一致
function perSecond() {
  return game.probes * D.numbers.probeOutput;
}

/* ---------- 字符解析系统:上线前,所有文字一律显示为 ? ---------- */
let charsOnline = false;   // 字符解析系统是否已上线
const maskedLines = [];    // 上线前打印的日志行,上线时要一次性还原

// 统一的"显示文本"入口:没上线就一律问号,长度与真实文字相同
function T(text) {
  if (charsOnline) return text;
  return '?'.repeat(Array.from(text).length);
}

/* ---------- 2. 日志:排队,一行一行打字打出 ---------- */
const logEl = document.getElementById('log');
const queue = [];
let busy  = false;   // 是否正在打某一行
let skip  = false;   // 玩家点击后,当前行立刻显示完
let activeTimer = null;   // 当前正在打字的那一行的定时器
let lastLine = null;      // 最近一行:{ el, base, count, group } —— 用于重复操作折叠

// opts: { cls, instant, revealAll, group, important }
function log(text, opts) {
  opts = opts || {};

  // 重复操作折叠:与上一行同组时,不再新增行,只把计数 +1
  if (opts.group && lastLine && lastLine.group === opts.group
      && lastLine.el === logEl.lastElementChild) {
    lastLine.count += 1;
    lastLine.base = text;   // 用最新的数据,而不是第一次那条
    lastLine.el.textContent = lastLine.base + ' ×' + lastLine.count;
    // 日志历史里的最后一条同步更新
    if (game.logHistory.length) {
      game.logHistory[game.logHistory.length - 1].text = lastLine.base + ' ×' + lastLine.count;
    }
    logEl.scrollTop = logEl.scrollHeight;
    return;
  }

  queue.push({
    text: text,
    cls: opts.cls,
    instant: opts.instant,
    revealAll: opts.revealAll,
    group: opts.group,
    important: opts.important,
  });
  pump();
}

// 记录一行到日志历史(刷新后原样恢复);只保留最近 400 行
function pushHistory(text, cls) {
  game.logHistory.push({ text: text, cls: cls || '' });
  if (game.logHistory.length > 400) game.logHistory.shift();
}

function pump() {
  if (busy || queue.length === 0) return;
  busy = true;
  skip = false;

  const item = queue.shift();
  const line = document.createElement('div');
  line.className = 'line' + (item.cls ? ' ' + item.cls : '');
  logEl.appendChild(line);

  // 转折行(revealAll)自己可以被读到;在它之前的行,先显示成问号
  const masked = !charsOnline && !item.revealAll;
  const shown  = masked ? '?'.repeat(Array.from(item.text).length) : item.text;
  if (masked) maskedLines.push({ el: line, text: item.text });

  // 记下"最近一行",供重复操作折叠使用;重要消息则归档
  lastLine = item.group ? { el: line, base: item.text, count: 1, group: item.group } : null;
  if (item.important) game.importantLog.push({ text: item.text, cls: item.cls || '' });
  pushHistory(item.text, item.cls);

  // 高频短行(比如手动的 +1)用 instant,不排队打字,免得刷屏卡住
  if (item.instant) {
    line.textContent = shown;
    logEl.scrollTop = logEl.scrollHeight;
    finishLine(item);
    busy = false;
    pump();
    return;
  }

  const chars = Array.from(shown);   // Array.from 兼容中文与代理对
  let i = 0;
  activeTimer = setInterval(function () {
    if (skip) i = chars.length; else i++;
    line.textContent = chars.slice(0, i).join('');
    logEl.scrollTop = logEl.scrollHeight;
    if (i >= chars.length) {
      clearInterval(activeTimer);
      activeTimer = null;
      finishLine(item);
      busy = false;
      pump();
    }
  }, 12);
}

// 一行打完后:若它是转折行,就打开字符解析系统,并还原之前所有问号
function finishLine(item) {
  if (item.revealAll && !charsOnline) {
    charsOnline = true;
    for (const m of maskedLines) {
      m.el.textContent = m.text;
      m.el.classList.add('reveal');
    }
    maskedLines.length = 0;
    render();   // 让顶栏/侧栏的文字也立刻显示出真实内容
  }
}

// 打字途中点一下屏幕,当前行立刻显示完
document.addEventListener('click', function () { skip = true; });

/* ---------- 3. 推进:按"真实经过的时间"算 ---------- */
// 关键:不数"跳了几次",而是量"过了多久"。
// 这样即使切到别的标签页、浏览器把定时器降频,收益也不会算错。
function tick() {
  const now = Date.now();
  const dt  = Math.min((now - game.lastTick) / 1000, 5); // 一次最多补 5 秒
  game.lastTick = now;
  if (!running) return;          // 封面 / 未开始时,时间不流动
  game.timeSec += dt;
  game.material += perSecond() * dt;
  checkStory();                  // 数值一达标,剧情 / 引导就顺着打出来
  render();
}

/* ---------- 4. 渲染:把状态画到屏幕上 ---------- */
const readoutEl  = document.getElementById('readout');
const cmdEl      = document.getElementById('commands');
const headerTime = document.getElementById('header-time');
const headerTitle = document.getElementById('header-title');
const hintEl     = document.getElementById('hint');

// 命令提示行:悬停 / 聚焦某个命令时显示它的说明;
// 没有悬停任何东西时,显示"引导提示"(由当前进度决定,数据在 game-data.js 的 guideHints)。
let hoverHint = '';
function setHint(text) { hoverHint = text || ''; paintHint(); }
function paintHint() { hintEl.textContent = hoverHint || guideHint(); }

// 侧栏读数面板:悬停每一行时,也在提示行显示它的说明(数据在 game-data.js 的 panelHints)
readoutEl.addEventListener('mouseover', function (e) {
  const t = e.target.closest('[data-hint]');
  if (t) setHint(t.getAttribute('data-hint'));
});
readoutEl.addEventListener('mouseout', function (e) {
  if (e.target.closest('[data-hint]')) setHint('');
});

function two(n) { return String(n).padStart(2, '0'); }
function fmtTime(sec) {
  const t = Math.floor(sec);
  return two(Math.floor(t / 3600)) + ':' + two(Math.floor(t / 60) % 60) + ':' + two(t % 60);
}

function render() {
  // 顶栏:标题 + 计时 T+时:分:秒(未上线时都是问号)
  headerTitle.textContent = T(D.title);
  headerTime.textContent = T('T+' + fmtTime(game.timeSec));

  // 右侧读数:数字 + 朝向"下一次复制"的 ASCII 进度条
  const need   = D.numbers.replicateCost;
  const filled = Math.round(Math.min(1, game.material / need) * 12);
  const bar    = '█'.repeat(filled) + '░'.repeat(12 - filled);

  readoutEl.innerHTML =
      '<div class="row" data-hint="' + D.panelHints.material + '"><span>' + T('材料') + '</span><b>' + T(String(Math.floor(game.material))) + '</b></div>'
    + '<div class="bar" data-hint="' + D.panelHints.progress + '">' + T(bar) + '</div>'
    + '<div class="row" data-hint="' + D.panelHints.probes + '"><span>' + T('探测器') + '</span><b>' + T(game.probes + ' 台') + '</b></div>'
    + '<div class="row" data-hint="' + D.panelHints.output + '"><span>' + T('产出') + '</span><b>' + T(perSecond().toFixed(1) + ' /秒') + '</b></div>';

  // 命令按钮的可用状态
  for (const c of D.commands) {
    const btn = document.getElementById('btn-' + c.id);
    if (btn && c.costMaterial != null) {
      btn.disabled = game.material < c.costMaterial;
    }
  }

  paintHint();   // 引导提示随进度变化
}

/* ---------- 剧情 / 引导:节点表驱动(内容全在 game-data.js 的 story) ---------- */
// 节点的 when 条件:写了几个就要同时满足几个
function storyReady(when) {
  const w = when || {};
  if (w.onBoot && !bootDone) return false;
  if (w.after  && game.fired.indexOf(w.after) < 0) return false;
  if (w.commandsRun != null && game.commandsRun < w.commandsRun) return false;
  if (w.material    != null && game.material    < w.material)    return false;
  if (w.probes      != null && game.probes      < w.probes)      return false;
  if (w.timeSec     != null && game.timeSec     < w.timeSec)     return false;
  return true;
}

// 扫一遍剧情表:新满足的节点按表内顺序打出来;一次可以连着触发多个(如 p2 → p3 → p4)
function checkStory() {
  let again = true;
  let guard = 0;
  while (again && guard++ < 50) {
    again = false;
    for (const node of D.story) {
      if (game.fired.indexOf(node.id) >= 0) continue;
      if (!storyReady(node.when)) continue;
      game.fired.push(node.id);
      for (const line of node.lines) {
        log(line.text, { cls: line.cls, important: node.important !== false });
      }
      again = true;   // 刚触发的节点可能解锁了下一个(如 after),再扫一遍
    }
  }
}

// 旧存档没有剧情进度时的兜底:把"此刻已经该发生"的节点直接记为已触发,
// 避免读档瞬间一次刷出一大段剧情。返回是否有内容被跳过。
function backfillStory() {
  let skipped = false;
  let guard = 0;
  while (guard++ < 50) {
    const node = D.story.find(function (n) {
      return game.fired.indexOf(n.id) < 0 && storyReady(n.when);
    });
    if (!node) break;
    game.fired.push(node.id);
    skipped = true;
  }
  return skipped;
}

// 引导提示:输入框为空且没有悬停任何东西时,提示行常显的那一句
function guideHint() {
  if (!bootDone) return '';
  let text = '';
  for (const g of D.guideHints) {
    if (storyReady(g.when)) text = g.text;   // 取满足条件的最后一条(越靠后 = 阶段越晚)
  }
  return text;
}

/* ---------- 建命令按钮(只建一次) ---------- */
function buildCommands() {
  cmdEl.innerHTML = '';   // 清掉旧按钮(新档/读档切换时避免重复)
  for (const c of D.commands) {
    if (c.clickable === false) continue;   // 未解锁点击的命令先不出现(以后由科技树开启)
    const btn = document.createElement('button');
    btn.id = 'btn-' + c.id;
    btn.textContent = '[ ' + c.label + ' ]';
    btn.onclick = function () { runCommand(c.id); };
    // 用终端内建提示行,替代延迟长、样式不统一的浏览器原生 tooltip
    btn.onmouseenter = function () { setHint(c.hint); };
    btn.onmouseleave = function () { setHint(''); };
    btn.onfocus      = function () { setHint(c.hint); };
    btn.onblur       = function () { setHint(''); };
    cmdEl.appendChild(btn);
  }
  setInputEnabled(true);
  render();
}

/* ---------- 命令行:输入 + 命令面板 + Tab 补全 ---------- */
const cmdInput  = document.getElementById('cmd-input');
const paletteEl = document.getElementById('palette');

// 启用 / 停用输入行(启动序列与封面期间停用)
function setInputEnabled(on) {
  cmdInput.disabled = !on;
  if (on) {
    cmdInput.focus();
  } else {
    cmdInput.value = '';
    hidePalette();
  }
}

// 前缀匹配 + 字母序
function matchCommands(prefix) {
  const p = prefix.trim().toLowerCase();
  return D.commands
    .filter(function (c) { return c.label.toLowerCase().indexOf(p) === 0; })
    .sort(function (a, b) { return a.label < b.label ? -1 : 1; });
}

// 命令面板:紧贴输入行下方
function showPalette() {
  const matches = matchCommands(cmdInput.value);
  paletteEl.innerHTML = '';

  if (!cmdInput.value.trim()) { hidePalette(); return; }

  if (matches.length === 0) {
    const none = document.createElement('div');
    none.className = 'palette-item dim';
    none.textContent = '命令以 / 开头;输入 / 查看全部命令。';
    paletteEl.appendChild(none);
    paletteEl.classList.remove('hidden');
    return;
  }

  matches.forEach(function (c, i) {
    const item = document.createElement('div');
    item.className = 'palette-item' + (i === 0 ? ' active' : '');
    item.textContent = c.label + '  —  ' + (c.hint || '');
    item.onmousedown = function (e) {   // 用 mousedown:别让输入框先失焦
      e.preventDefault();
      cmdInput.value = '';
      hidePalette();
      runCommand(c.id);
      cmdInput.focus();
    };
    paletteEl.appendChild(item);
  });

  paletteEl.classList.remove('hidden');
}

function hidePalette() {
  paletteEl.classList.add('hidden');
  paletteEl.innerHTML = '';
}

// 回车:执行输入的命令
function runTyped() {
  const text = cmdInput.value.trim().toLowerCase();
  hidePalette();
  if (!text) return;
  const cmd = D.commands.find(function (c) { return c.label.toLowerCase() === text; });
  if (cmd) {
    cmdInput.value = '';
    runCommand(cmd.id);
  } else {
    log('未知命令:' + text + '(命令需以 / 开头,如 /mine)', { cls: 'err', instant: true });
  }
}

cmdInput.addEventListener('input', showPalette);

cmdInput.addEventListener('keydown', function (e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const matches = matchCommands(cmdInput.value);
    if (matches.length) cmdInput.value = matches[0].label;   // Tab 补全到第一项
    showPalette();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runTyped();
  } else if (e.key === 'Escape') {
    hidePalette();
  }
});

/* ---------- 响应命令 ---------- */
function runCommand(id) {
  game.commandsRun += 1;

  if (id === 'mine') {
    game.material += D.numbers.manualMine;
    log('+1 材料', { cls: 'dim', instant: true, group: 'mine' });

  } else if (id === 'replicate') {
    const cost = D.numbers.replicateCost;
    if (game.material < cost) {
      log('材料不足:需要 ' + cost + ' 材料。', { cls: 'err', instant: true });
    } else {
      game.material -= cost;
      game.probes  += 1;
      log('> /replicate', { cls: 'ok', instant: true, group: 'replicate' });
    }

  } else if (id === 'save') {
    saveGame();

  } else if (id === 'exit') {
    exitToCover();
    return;   // 已切回封面,不必再渲染游戏界面
  }
  checkStory();   // 命令可能刚好跨过某个剧情 / 引导的触发点
  render();
}

/* ---------- 存档:localStorage ---------- */
const SAVE_KEY = 'vn-01-save';
let autoSaveTimer = null;

function readSave() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// 当前状态的快照;active 表示「正在游戏中」(决定刷新后是否自动续玩)
function snapshot() {
  return {
    v: D.version,
    savedAt: Date.now(),
    active: running,
    material: game.material,
    probes:   game.probes,
    timeSec:  game.timeSec,
    commandsRun: game.commandsRun,
    fired:    game.fired,
    importantLog: game.importantLog,
    logHistory: game.logHistory,
  };
}

function writeSave(data) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function saveGame(silent) {
  writeSave(snapshot());
  if (!silent) {
    log('> /save', { cls: 'cmd' });
    log('  进度已保存。T+' + fmtTime(game.timeSec), { cls: 'ok' });
  }
}

// 运行中每 3 秒自动存一次 —— 刷新 / 意外关闭也能续上
function startAutoSave() {
  stopAutoSave();
  autoSaveTimer = setInterval(function () {
    if (running) writeSave(snapshot());
  }, 3000);
}
function stopAutoSave() {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
}

function applySave(d) {
  bootDone = true;   // 读档时不存在启动序列,引导提示与剧情条件直接可用
  game.material = Number(d.material) || 0;
  game.probes   = Number(d.probes)   || 1;
  game.timeSec  = Number(d.timeSec)  || 0;
  game.commandsRun = Number(d.commandsRun) || 0;
  game.importantLog = Array.isArray(d.importantLog) ? d.importantLog : [];
  game.logHistory   = Array.isArray(d.logHistory)   ? d.logHistory   : [];
  // 旧存档(V0.1.0 之前)没有剧情进度:把"此刻已经该发生"的节点记为已触发,避免读档瞬间刷屏
  const legacy = !Array.isArray(d.fired);
  game.fired = legacy ? [] : d.fired.slice();
  game.lastTick = Date.now();
  if (legacy) backfillStory();
}

/* ---------- 清空日志(开新档 / 读档时用) ---------- */
function clearLog() {
  if (activeTimer) { clearInterval(activeTimer); activeTimer = null; }
  queue.length = 0;
  maskedLines.length = 0;
  busy = false;
  setHint('');
  logEl.innerHTML = '';
}

/* ---------- 界面切换 ---------- */
// name: 'cover' | 'game' | 'settings' | 'quit'
function showScreen(name) {
  const map = { cover: 'cover', game: 'screen', settings: 'settings', quit: 'quit' };
  for (const key in map) {
    document.getElementById(map[key]).classList.toggle('hidden', name !== key);
  }
}

/* ---------- 启动流程 ---------- */
function boot() {
  render();   // 先把顶栏/侧栏画成问号状态
  setInputEnabled(false);   // 启动序列期间不接受输入

  // 依次打出启动日志(条目是对象:{ text, revealAll })
  D.bootLog.forEach(function (entry, i) {
    setTimeout(function () {
      log(entry.text, { revealAll: entry.revealAll, important: true });
    }, i * 320);
  });

  // "等待输入。"打完后:命令按钮出现,引导(P1)接着开口
  setTimeout(function () {
    bootDone = true;
    buildCommands();
    checkStory();
    paintHint();
  }, D.bootLog.length * 320 + 200);
}

function resetGame() {
  game.material = 0;
  game.probes   = 1;
  game.timeSec  = 0;
  game.commandsRun = 0;
  game.fired    = [];
  game.importantLog = [];
  game.logHistory = [];
  game.lastTick = Date.now();
}

function startNew() {
  resetGame();
  clearLog();
  charsOnline = false;   // 新档:重新经历一次"字符解析系统上线"
  bootDone = false;      // 新档:引导要等启动序列打完
  running = true;
  setInputEnabled(false);   // 启动序列期间不能输入
  showScreen('game');
  startAutoSave();
  writeSave(snapshot());
  boot();
}

function startLoaded(d) {
  applySave(d);
  clearLog();
  charsOnline = true;    // 读档:解析器早已上线,直接可读
  running = true;
  showScreen('game');

  // 先把"以前的信息"折叠行放出来(在"存档已载入"之前)
  const archived = game.importantLog.slice();
  if (archived.length) addArchivedEntry(archived);

  render();
  log('存档已载入。', { cls: 'ok' });
  log('  从 T+' + fmtTime(game.timeSec) + ' 继续。', { cls: 'dim' });
  buildCommands();
  startAutoSave();
}

// 刷新后接着跑:把整屏日志原样贴回来,手感等同于"什么都没发生"
function resumeSession(d) {
  applySave(d);
  clearLog();
  charsOnline = true;
  running = true;
  showScreen('game');
  render();
  renderHistory(game.logHistory);
  buildCommands();
  startAutoSave();
}

// 把整段日志历史原样贴回终端
function renderHistory(history) {
  for (const m of history) {
    const el = document.createElement('div');
    el.className = 'line' + (m.cls ? ' ' + m.cls : '');
    el.textContent = m.text;
    logEl.appendChild(el);
  }
  lastLine = null;
  logEl.scrollTop = logEl.scrollHeight;
}

/* ---------- 「以前的信息」:折叠展示退出前的重要消息(可展开 / 收起) ---------- */
function addArchivedEntry(archived) {
  const entry = document.createElement('div');
  const shown = [];
  let expanded = false;

  entry.className = 'line archived';

  function setLabel() {
    entry.textContent = expanded ? '△ 以前的信息 (点击收起)' : '▽ 以前的信息 (点击展开)';
  }
  setLabel();

  entry.onclick = function () {
    if (!expanded) {
      for (const m of archived) {
        const el = document.createElement('div');
        el.className = 'line' + (m.cls ? ' ' + m.cls : '');
        el.textContent = m.text;
        logEl.insertBefore(el, entry);   // 展开的内容插在折叠行上方
        shown.push(el);
      }
      expanded = true;
    } else {
      for (const el of shown) el.remove();   // 收起:把展开的内容全部拿掉
      shown.length = 0;
      expanded = false;
    }
    setLabel();
    logEl.scrollTop = logEl.scrollHeight;
  };

  logEl.appendChild(entry);
  lastLine = null;   // 折叠行不算「最近一行」
}

/* ---------- 返回封面 / 退出 ---------- */
function exitToCover() {
  running = false;
  writeSave(snapshot());   // active:false —— 刷新后会停在封面,而不是自动续玩
  showCover();
}

function quitGame() {
  showScreen('quit');
  // 浏览器一般只允许脚本关闭"由脚本打开的"窗口;从本地双击打开时多半会被拦下,
  // 所以先显示"会话已终止"画面,再尝试关闭窗口。
  try { window.close(); } catch (e) { /* 忽略 */ }
}

/* ---------- 设置:音乐 / 音效音量 ---------- */
const SETTINGS_KEY = 'vn-01-settings';
const audioSettings = { music: 0.5, sfx: 0.5 };   // 取值 0 ~ 1

function readSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (typeof d.music === 'number') audioSettings.music = d.music;
    if (typeof d.sfx   === 'number') audioSettings.sfx   = d.sfx;
  } catch (e) { /* 设置损坏就忽略 */ }
}

function writeSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(audioSettings));
}

// 音频接口:现在只记录音量,尚未加载音频素材。
// 以后接真实音频时,把 TODO 换成操作 <audio> / WebAudio 即可,调用方不用改。
const AudioSystem = {
  setMusicVolume: function (v) { audioSettings.music = v; writeSettings(); /* TODO */ },
  setSfxVolume:   function (v) { audioSettings.sfx   = v; writeSettings(); /* TODO */ },
  playSfx:  function (name) { /* TODO: 播放音效 name */ },
  playMusic: function (name) { /* TODO: 播放音乐 name */ },
};

// 设置项 id → 音频通道(设置项表在 game-data.js 的 settings)
const SETTING_APPLY = {
  music: function (v) { AudioSystem.setMusicVolume(v); },
  sfx:   function (v) { AudioSystem.setSfxVolume(v); },
};

function buildSettings() {
  const list = document.getElementById('settings-list');
  list.innerHTML = '';
  for (const s of D.settings) {
    const row   = document.createElement('div');
    const label = document.createElement('span');
    const input = document.createElement('input');
    const val   = document.createElement('b');

    row.className = 'setting-row';
    label.textContent = s.label;

    input.type = 'range';
    input.min = 0;
    input.max = 100;
    input.step = 1;
    input.value = Math.round(audioSettings[s.id] * 100);

    val.textContent = input.value + '%';

    input.oninput = function () {
      val.textContent = input.value + '%';
      if (SETTING_APPLY[s.id]) SETTING_APPLY[s.id](Number(input.value) / 100);
    };

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(val);
    list.appendChild(row);
  }
}

function openSettings() {
  buildSettings();
  showScreen('settings');
}

/* ---------- 封面 ---------- */
function bindCover() {
  document.getElementById('btn-new').onclick = startNew;
  document.getElementById('btn-load').onclick = function () {
    const d = readSave();
    if (d) startLoaded(d);
  };
  document.getElementById('btn-settings').onclick = openSettings;
  document.getElementById('btn-quit').onclick = quitGame;
  document.getElementById('btn-settings-back').onclick = function () {
    showScreen('cover');
    refreshCover();
  };
}

// 回到封面(不删存档,只是停止运行)
function showCover() {
  running = false;
  stopAutoSave();
  setInputEnabled(false);
  clearLog();
  showScreen('cover');
  refreshCover();
}

// 刷新封面上的动态部分(版本号、是否可读存档)
function refreshCover() {
  document.getElementById('cover-version').textContent = '版本 ' + D.version;
  document.getElementById('btn-load').disabled = !readSave();
}

// 离开页面时(刷新 / 关闭)顺手存一次;不再弹确认框
window.addEventListener('beforeunload', function () {
  if (running) writeSave(snapshot());
});
document.addEventListener('visibilitychange', function () {
  if (document.hidden && running) writeSave(snapshot());
});

/* ---------- 这次是「刷新」还是「重新打开」? ---------- */
// sessionStorage 在刷新时保留、关闭标签页后清空 —— 用它把 F5 和 ×关闭区分开:
//   F5 刷新        → 接着玩(整屏内容原样接上)
//   ×关闭后再打开  → 停在封面(要自己点「加载存档」,才能看到「以前的信息」)
const ALIVE_KEY = 'vn-01-alive';
let isReload = true;   // 兜底:万一 sessionStorage 不可用,退回"总是续玩"
try {
  isReload = sessionStorage.getItem(ALIVE_KEY) === '1';
  sessionStorage.setItem(ALIVE_KEY, '1');
} catch (e) { /* 忽略:保留上面的默认值 */ }

setInputEnabled(false);   // 先锁住输入行,进游戏后再打开
readSettings();
bindCover();

const savedSession = readSave();
if (isReload && savedSession && savedSession.active) {
  resumeSession(savedSession);            // 刷新:把整屏内容原样接上
} else {
  // 不是刷新(比如关掉窗口再打开):停在封面,并标记为"未在游戏中"
  if (savedSession) { savedSession.active = false; writeSave(savedSession); }
  showCover();
}

setInterval(tick, 100);   // 每 0.1 秒推进一次;具体加多少由真实时间决定
