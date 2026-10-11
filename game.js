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

/* ---------- 2. 日志:排队,一行一行打字打出 ---------- */
const logEl = document.getElementById('log');
const queue = [];
let busy  = false;   // 是否正在打某一行
let skip  = false;   // 玩家点击后,当前行立刻显示完

function log(text, cls, instant) {
  queue.push({ text: text, cls: cls, instant: instant });
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

  // 高频短行(比如手动的 +1)用 instant,不排队打字,免得刷屏卡住
  if (item.instant) {
    line.textContent = item.text;
    logEl.scrollTop = logEl.scrollHeight;
    busy = false;
    pump();
    return;
  }

  const chars = Array.from(item.text);   // Array.from 兼容中文与代理对
  let i = 0;
  const timer = setInterval(function () {
    if (skip) i = chars.length; else i++;
    line.textContent = chars.slice(0, i).join('');
    logEl.scrollTop = logEl.scrollHeight;
    if (i >= chars.length) {
      clearInterval(timer);
      busy = false;
      pump();
    }
  }, 12);
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

function two(n) { return String(n).padStart(2, '0'); }

function render() {
  // 顶部计时 T+时:分:秒
  const t = Math.floor(game.timeSec);
  headerTime.textContent = 'T+' + two(Math.floor(t / 3600)) + ':'
    + two(Math.floor(t / 60) % 60) + ':' + two(t % 60);

  // 右侧读数:数字 + 朝向"下一次复制"的 ASCII 进度条
  const need   = D.numbers.replicateCost;
  const filled = Math.round(Math.min(1, game.material / need) * 12);
  const bar    = '█'.repeat(filled) + '░'.repeat(12 - filled);

  readoutEl.innerHTML =
      '<div class="row"><span>材料</span><b>' + Math.floor(game.material) + '</b></div>'
    + '<div class="bar">' + bar + '</div>'
    + '<div class="row"><span>探测器</span><b>' + game.probes + ' 台</b></div>'
    + '<div class="row"><span>产出</span><b>' + perSecond().toFixed(1) + ' /秒</b></div>';

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
    log('+1 材料', 'dim', true);          // instant:高频短行,不打字

  } else if (id === 'replicate') {
    const cost = D.numbers.replicateCost;
    if (game.material < cost) {
      log('> replicate', 'cmd');
      log('  材料不足:需要 ' + cost + '。', 'err');
    } else {
      const before = game.probes;
      game.material -= cost;
      game.probes  += 1;
      log('> replicate', 'cmd');
      log('  探测器 ' + before + ' → ' + game.probes, 'ok');
    }
  }
  render();
}

/* ---------- 启动 ---------- */
function boot() {
  document.getElementById('header-title').textContent = D.title;

  // 依次打出启动日志
  D.bootLog.forEach(function (line, i) {
    setTimeout(function () { log(line); }, i * 320);
  });

  // 启动日志打完后,再出现命令按钮
  setTimeout(buildCommands, D.bootLog.length * 320 + 200);
}

boot();
setInterval(tick, 100);   // 每 0.1 秒推进一次;具体加多少由真实时间决定
