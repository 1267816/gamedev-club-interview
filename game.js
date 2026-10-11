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
};

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

// opts: { cls, instant, revealAll }
function log(text, opts) {
  opts = opts || {};
  queue.push({ text: text, cls: opts.cls, instant: opts.instant, revealAll: opts.revealAll });
  pump();
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
  render();
}

/* ---------- 4. 渲染:把状态画到屏幕上 ---------- */
const readoutEl  = document.getElementById('readout');
const cmdEl      = document.getElementById('commands');
const headerTime = document.getElementById('header-time');
const headerTitle = document.getElementById('header-title');
const hintEl     = document.getElementById('hint');

// 命令提示行:悬停 / 聚焦某个命令时,在按钮上方显示它的说明
function setHint(text) { hintEl.textContent = text || ''; }

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
      '<div class="row"><span>' + T('材料') + '</span><b>' + T(String(Math.floor(game.material))) + '</b></div>'
    + '<div class="bar">' + T(bar) + '</div>'
    + '<div class="row"><span>' + T('探测器') + '</span><b>' + T(game.probes + ' 台') + '</b></div>'
    + '<div class="row"><span>' + T('产出') + '</span><b>' + T(perSecond().toFixed(1) + ' /秒') + '</b></div>';

  // 命令按钮的可用状态
  for (const c of D.commands) {
    const btn = document.getElementById('btn-' + c.id);
    if (btn && c.costMaterial != null) {
      btn.disabled = game.material < c.costMaterial;
    }
  }
}

/* ---------- 建命令按钮(只建一次) ---------- */
function buildCommands() {
  cmdEl.innerHTML = '';   // 清掉旧按钮(新档/读档切换时避免重复)
  for (const c of D.commands) {
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
  render();
}

/* ---------- 响应命令 ---------- */
function runCommand(id) {
  if (id === 'mine') {
    game.material += D.numbers.manualMine;
    log('+1 材料', { cls: 'dim', instant: true });   // instant:高频短行,不打字

  } else if (id === 'replicate') {
    const cost = D.numbers.replicateCost;
    if (game.material < cost) {
      log('> replicate', { cls: 'cmd' });
      log('  材料不足:需要 ' + cost + '。', { cls: 'err' });
    } else {
      const before = game.probes;
      game.material -= cost;
      game.probes  += 1;
      log('> replicate', { cls: 'cmd' });
      log('  探测器 ' + before + ' → ' + game.probes, { cls: 'ok' });
    }

  } else if (id === 'save') {
    saveGame();
  }
  render();
}

/* ---------- 存档:localStorage ---------- */
const SAVE_KEY = 'vn-01-save';

function readSave() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveGame() {
  const data = {
    v: D.version,
    savedAt: Date.now(),
    material: game.material,
    probes:   game.probes,
    timeSec:  game.timeSec,
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  log('> save', { cls: 'cmd' });
  log('  进度已保存。T+' + fmtTime(game.timeSec), { cls: 'ok' });
}

function applySave(d) {
  game.material = Number(d.material) || 0;
  game.probes   = Number(d.probes)   || 1;
  game.timeSec  = Number(d.timeSec)  || 0;
  game.lastTick = Date.now();
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
function showScreen(name) {
  document.getElementById('cover').classList.toggle('hidden', name !== 'cover');
  document.getElementById('screen').classList.toggle('hidden', name !== 'game');
}

/* ---------- 启动流程 ---------- */
function boot() {
  render();   // 先把顶栏/侧栏画成问号状态

  // 依次打出启动日志(条目是对象:{ text, revealAll })
  D.bootLog.forEach(function (entry, i) {
    setTimeout(function () { log(entry.text, entry); }, i * 320);
  });

  // "等待输入。"打完后,命令按钮才出现
  setTimeout(buildCommands, D.bootLog.length * 320 + 200);
}

function resetGame() {
  game.material = 0;
  game.probes   = 1;
  game.timeSec  = 0;
  game.lastTick = Date.now();
}

function startNew() {
  resetGame();
  clearLog();
  charsOnline = false;   // 新档:重新经历一次"字符解析系统上线"
  running = true;
  showScreen('game');
  boot();
}

function startLoaded(d) {
  applySave(d);
  clearLog();
  charsOnline = true;    // 读档:解析器早已上线,直接可读
  running = true;
  showScreen('game');
  render();
  log('存档已载入。', { cls: 'ok' });
  log('  从 T+' + fmtTime(game.timeSec) + ' 继续。', { cls: 'dim' });
  buildCommands();
}

/* ---------- 封面 ---------- */
function initCover() {
  showScreen('cover');
  running = false;
  document.getElementById('cover-version').textContent = '版本 ' + D.version;

  const btnLoad = document.getElementById('btn-load');
  btnLoad.disabled = !readSave();          // 没有存档时不能读
  btnLoad.onclick = function () {
    const d = readSave();
    if (d) startLoaded(d);
  };
  document.getElementById('btn-new').onclick = startNew;
}

initCover();
setInterval(tick, 100);   // 每 0.1 秒推进一次;具体加多少由真实时间决定
