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
  const timer = setInterval(function () {
    if (skip) i = chars.length; else i++;
    line.textContent = chars.slice(0, i).join('');
    logEl.scrollTop = logEl.scrollHeight;
    if (i >= chars.length) {
      clearInterval(timer);
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
  game.timeSec += dt;
  game.material += perSecond() * dt;
  render();
}

/* ---------- 4. 渲染:把状态画到屏幕上 ---------- */
const readoutEl  = document.getElementById('readout');
const cmdEl      = document.getElementById('commands');
const headerTime = document.getElementById('header-time');
const headerTitle = document.getElementById('header-title');

function two(n) { return String(n).padStart(2, '0'); }

function render() {
  // 顶栏:标题 + 计时 T+时:分:秒(未上线时都是问号)
  headerTitle.textContent = T(D.title);
  const t = Math.floor(game.timeSec);
  headerTime.textContent = T(
    'T+' + two(Math.floor(t / 3600)) + ':' + two(Math.floor(t / 60) % 60) + ':' + two(t % 60)
  );

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
  for (const c of D.commands) {
    const btn = document.createElement('button');
    btn.id = 'btn-' + c.id;
    btn.textContent = '[ ' + c.label + ' ]';
    btn.title = c.hint || '';
    btn.onclick = function () { runCommand(c.id); };
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
  }
  render();
}

/* ---------- 启动 ---------- */
function boot() {
  render();   // 先把顶栏/侧栏画成问号状态

  // 依次打出启动日志(条目是对象:{ text, revealAll })
  D.bootLog.forEach(function (entry, i) {
    setTimeout(function () { log(entry.text, entry); }, i * 320);
  });

  // "等待输入。"打完后,命令按钮才出现
  setTimeout(buildCommands, D.bootLog.length * 320 + 200);
}

boot();
setInterval(tick, 100);   // 每 0.1 秒推进一次;具体加多少由真实时间决定
