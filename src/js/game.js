/* ============================================================
   game.js
   只做四件事:1 保存状态 → 2 推进时间 → 3 渲染 → 4 响应命令。
   所有内容(文字/数值/命令)都在 game-data.js,这里只读它。
   ============================================================ */

const D = GAME_DATA;

/* ---------- 1. 状态:所有会变的东西都在这一个对象里 ---------- */
const game = {
  material: 0,          // 材料(存量,受仓库上限)
  energy:   0,          // 能量(存量,上限由反应堆给)      —— V0.1.2
  data:     0,          // 数据(存量,解析器产出)          —— V0.1.2
  probes:   1,          // 探测器数量
  scan:     0,          // 星球探测进度 0~100             —— V0.1.2
  buildings: {},        // 建筑数量,如 { reactor: 2, core: 1 }  —— V0.1.2
  modules:   {},        // 模块数量,如 { drone: 2, decoder: 1 } —— V0.1.2
  off:       {},        // 被停用的模块 { rep: true }            —— V0.1.3
  ending:    null,      // 结局:'gravekeeper' | 'starry' | null  —— V0.1.3
  choiceSnapshot: null, // "选择时刻"的经济快照,用于结局后回档  —— V0.1.3
  timeSec:  0,          // 游戏内经过的秒数
  lastTick: Date.now(), // 上一次推进的真实时刻
  commandsRun: 0,       // 已执行命令数(剧情触发用)
  fired:    [],         // 已触发的剧情节点 id(剧情 / 引导见 game-data.js 的 story)
  unlocked: [],         // 已解锁的科技 id(V0.1.1 起)
  achievements: [],     // 已获得的成就 id(未获得的在封面不显示)
  importantLog: [],     // 重要消息(剧情 / 系统提示),存档时一并保存
  logHistory: [],       // 终端日志历史,刷新后原样恢复
};

// 启动序列是否已打完(P1 引导、引导提示都要等它结束)
let bootDone = false;

// 游戏是否在运行:封面、未开始时不流动
let running = false;

// 由状态"算出来"的值,不存起来,每次现算,避免前后不一致
const has = function (id) { return game.unlocked.indexOf(id) >= 0; };
const bCount = function (id) { return game.buildings[id] || 0; };
const mCount = function (id) { return game.modules[id] || 0; };
// 模块可以停用(用户要求:复制助手会把材料吃光,必须能关)
const stopped = function (id) { return !!(game.off && game.off[id]); };
const mActive = function (id) { return stopped(id) ? 0 : mCount(id); };

// 科技给出的乘算倍率(第 11.2 节的"倍增定律":效果必须是乘算)
function effects() {
  let probeMul = 1, slotMul = 1, reactorMul = 1, drainMul = 1, decodeMul = 1;
  if (has('probe_eff'))  probeMul *= 1.5;
  if (has('core_eff'))   { slotMul *= 2; drainMul *= 0.8; }
  if (has('decode_eff')) decodeMul *= 1.6;
  if (has('fusion'))     reactorMul *= 1.6;
  if (has('bootstrap'))  probeMul *= 2;
  return { probeMul: probeMul, slotMul: slotMul, reactorMul: reactorMul, drainMul: drainMul, decodeMul: decodeMul };
}

// —— 各资源的速率 / 上限 ——
function matCap()      { return D.numbers.warehouseCap * Math.pow(D.numbers.warehouseMul, bCount('warehouse')); }
// 采集助手按"每台探测器"加成:规模越大越有用(用户反馈:原来是死板的 +1.5/秒,中后期毫无意义)
function matRate() {
  return game.probes * (D.numbers.probeOutput * effects().probeMul
    + D.numbers.droneRatePerProbe * slotsFor('drone'));
}
function energyGross() { return bCount('reactor') * D.numbers.reactorRate * effects().reactorMul; }
function energyNeed()  { return bCount('core') * D.numbers.coreDrain * effects().drainMul; }
function slotsUsed()   { return mCount('drone') + mCount('decoder') + mCount('rep'); }
function slotsTotal()  { return Math.floor(bCount('core') * D.numbers.slotPerCore * effects().slotMul * energyScale); }

// 算力槽不够时,模块按"模块表的顺序"依次上线,后面的只能空转 ——
// 这样"能量不足 → 算力降速"才有实际后果,玩家也可以靠停用模块来腾槽(用户要的开关就有了用处)
function slotsFor(id) {
  let left = slotsTotal();
  for (const m of D.modules) {
    const n = Math.min(mActive(m.id), Math.max(0, left));
    if (m.id === id) return n;
    left -= n;
  }
  return 0;
}
function dataRate()    { return slotsFor('decoder') * D.numbers.decoderRate * effects().decodeMul; }

// 复制的成本:10 × 1.10^(已经有的台数 - 1) —— V0.1.2 改成几何增长(bug 1 的修复)
function probeCost() { return D.numbers.probeBaseCost * Math.pow(D.numbers.probeGrowth, game.probes - 1); }

// 建筑 / 模块的第 n 个成本(几何增长)
function buildCostOf(table, id, count) {
  const x = D[table].find(function (y) { return y.id === id; });
  return Math.floor(x.cost.material * Math.pow(x.growth, count));
}
function costOf(node) {
  if (node.kind === 'tech') return node.cost;
  const count = node.kind === 'building' ? bCount(node.id) : mCount(node.id);
  return { material: buildCostOf(node.kind === 'building' ? 'buildings' : 'modules', node.id, count) };
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

  // 打字机正忙时,同组的新行要并进**队尾**那一条 ——
  // 否则剧情在打字的时候,连续的操作会一条条排队、最后全打出来刷屏(用户报的 bug 8)
  if (opts.group) {
    const tail = queue[queue.length - 1];
    if (tail && tail.group === opts.group) {
      tail.count = (tail.count || 1) + 1;
      tail.text = text;
      return;
    }
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
  // 折叠过的行:文本 + ×N(在队尾被合并进来的次数)
  const counted = item.count > 1 ? item.text + ' ×' + item.count : item.text;
  const shown  = masked ? '?'.repeat(Array.from(counted).length) : counted;
  if (masked) maskedLines.push({ el: line, text: counted });

  // 记下"最近一行",供重复操作折叠使用;重要消息则归档
  lastLine = item.group ? { el: line, base: item.text, count: item.count || 1, group: item.group } : null;
  if (item.important) game.importantLog.push({ text: counted, cls: item.cls || '' });
  pushHistory(counted, item.cls);

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
let energyScale = 1;    // 能量节流系数(0~1):能量不够时算力槽按比例减少
let repTimer = 0;       // 复制助手的计时器
let repDone = 0;        // 复制助手这一批自动复制了几台(攒够一批就写一行折叠日志)

function tick() {
  const now = Date.now();
  const dt  = Math.min((now - game.lastTick) / 1000, 5); // 一次最多补 5 秒
  game.lastTick = now;
  if (!running) return;          // 封面 / 未开始时,时间不流动
  game.timeSec += dt;

  // ① 材料:探测器 + 采集助手;超过仓库上限的部分会被浪费
  const cap = matCap();
  game.material = Math.min(game.material + matRate() * dt, cap);

  // ② 能量:反应堆产出、计算核心消耗;不够就按比例节流(算力降速)
  const gross = energyGross();
  const need  = energyNeed();
  const eCap  = bCount('reactor') * D.numbers.reactorCap;
  const usable = Math.min(game.energy / dt + gross, need);
  energyScale = need > 0 ? usable / need : 1;
  game.energy = Math.min(Math.max(game.energy + (gross - usable) * dt, 0), eCap);

  // ③ 数据:解析器产出
  game.data += dataRate() * dt;

  // ④ 复制助手:每 repEvery 秒自动复制一次。只在材料 ≥ 成本 × repReserve 时动手 ——
  //    否则它会把研究用的材料全吃掉(用户反馈的核心问题)
  if (slotsFor('rep') > 0) {
    repTimer += dt * slotsFor('rep');
    while (repTimer >= D.numbers.repEvery) {
      repTimer -= D.numbers.repEvery;
      const c = probeCost();
      if (game.material >= c * D.numbers.repReserve) {
        game.material -= c; game.probes += 1;
        repDone += 1;
      }
    }
  }

  // ⑤ 星球探测进度:探测器越多越快;覆盖率越接近满越难扫
  if (game.scan < 100) {
    const scanMul = has('comm') ? 1 : D.numbers.scanNoCommMul;
    const falloff = Math.max(0.25, 1 - game.scan / D.numbers.scanFalloff);
    // 解析器也在帮忙定位(它们本来就是在解析扫描数据):这样"投数据"的玩家探测不会掉队
    const decoderBonus = 1 + D.numbers.scanDecoderBonus * slotsFor('decoder');
    game.scan = Math.min(100, game.scan + game.probes * D.numbers.scanK * decoderBonus * scanMul * falloff * dt);
  }

  // ⑥ 复制助手干的活也要让玩家看见(不然"材料怎么少了"没人解释)——
  //    攒够一批才写一行,而且用同一组折叠
  if (repDone > 0) {
    log('> 自动复制', { cls: 'dim', instant: true, group: 'autorep' });
    repDone = 0;
  }

  checkStory();                  // 数值一达标,剧情 / 引导就顺着打出来
  checkAchievements();           // 探测进度 / 探测器数量这类"自己会涨"的条件也要一直盯着
  checkIdle();                   // 太久没动 → 指南系统提示一句
  updateTechLive();              // 科技树开着的时候,资源读数与按钮状态要跟着涨
  render();
}

/* ---------- 4. 渲染:把状态画到屏幕上 ---------- */
const readoutEl  = document.getElementById('readout');
const readoutTechEl = document.getElementById('readout-tech');   // 科技树右侧同一块读数(V0.1.4)
const cmdEl      = document.getElementById('commands');
const headerTime = document.getElementById('header-time');
const headerTitle = document.getElementById('header-title');
const hintEl     = document.getElementById('hint');

// 命令提示行:悬停 / 聚焦某个命令时显示它的说明;
// 没有悬停任何东西时,显示"引导提示"(由当前进度决定,数据在 game-data.js 的 guideHints)。
let hoverHint = '';
let hoverCmd = null;    // 正在悬停的命令(它的提示要每帧重算,否则"复制成本"会是旧的)
function setHint(text) { hoverHint = text || ''; hoverCmd = null; paintHint(); }
function setCmdHint(c) { hoverCmd = c; paintHint(); }
function paintHint() {
  hintEl.textContent = (hoverCmd ? commandHint(hoverCmd) : hoverHint) || guideHint();
}

// 侧栏读数面板:悬停每一行时,也在提示行显示它的说明(数据在 game-data.js 的 panelHints)
// 两块读数面板(终端 / 科技树)共用同一套悬停说明
function bindReadoutHints(el) {
  el.addEventListener('mouseover', function (e) {
    const t = e.target.closest('[data-hint]');
    if (t) setHint(t.getAttribute('data-hint'));
  });
  el.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-hint]')) setHint('');
  });
}
bindReadoutHints(readoutEl);
bindReadoutHints(readoutTechEl);

function two(n) { return String(n).padStart(2, '0'); }
function fmtTime(sec) {
  const t = Math.floor(sec);
  return two(Math.floor(t / 3600)) + ':' + two(Math.floor(t / 60) % 60) + ':' + two(t % 60);
}

// 大数缩写:1000 以下照常显示;以上用 K / M / B / T …(1e15 之后 JS 精度就不可靠了)
function fmtNum(n) {
  if (!isFinite(n)) return '∞';
  const abs = Math.abs(n);
  // 100 以下保留一位小数(用户报过"12.5 只显示 12");再大就取整,免得读数一直在跳
  if (abs < 100) return String(Math.round(n * 10) / 10);
  if (abs < 1000) return String(Math.floor(n));
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let v = n, i = -1;
  while (Math.abs(v) >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return v.toFixed(2) + units[i];
}

function render() {
  // 顶栏:标题 + 计时 T+时:分:秒(未上线时都是问号)
  headerTitle.textContent = T(D.title);
  headerTime.textContent = T('T+' + fmtTime(game.timeSec));

  // 读数面板:材料 → 探测进度(常驻名字 + 条)→ 探测器 / 产出 → 能量 → 算力 → 数据 → 科技
  // 这一块现在终端与科技树共用(render 时写进两个容器)
  const rows = [];
  const row = function (label, value, hintKey, warn) {
    rows.push('<div class="row' + (warn ? ' warn' : '') + '" data-hint="' + D.panelHints[hintKey] + '"><span>'
      + T(label) + '</span><b>' + T(value) + '</b></div>');
  };

  // 仓库满了就把这行标红:否则玩家会盯着满仓材料不知道"最高只能攒这么多"
  row('材料', fmtNum(game.material) + ' / ' + fmtNum(matCap()), 'material', game.material >= matCap() - 0.01);
  row('探测', game.scan.toFixed(1) + '%', 'scan');
  const filled = Math.round(Math.min(1, game.scan / 100) * 12);
  rows.push('<div class="bar">' + T('█'.repeat(filled) + '░'.repeat(12 - filled)) + '</div>');
  row('探测器', fmtNum(game.probes) + ' 台', 'probes');
  row('产出', fmtNum(matRate()) + ' /秒', 'output');

  if (has('reactor')) {
    const net = energyGross() - energyNeed();
    row('能量', Math.floor(game.energy) + ' / ' + fmtNum(bCount('reactor') * D.numbers.reactorCap)
      + '(' + (net >= 0 ? '+' : '') + net.toFixed(1) + '/s)', 'energy', net < 0);
  }
  if (has('core')) {
    const total = Math.floor(bCount('core') * D.numbers.slotPerCore * effects().slotMul * energyScale);
    // 正常玩不会超(装模块时拦了),但读档/改档可能超 —— 超了要明说,不然"6 / 3"看不懂
    const over = slotsUsed() > total;
    row('算力', slotsUsed() + ' / ' + total + ' 槽' + (over ? '（超载！)' : ''), 'compute', over);
  }
  if (has('decode')) row('数据', fmtNum(game.data) + '(+' + dataRate().toFixed(2) + '/s)', 'data');
  row('科技', game.unlocked.length + ' / ' + D.techs.length, 'tech');

  const html = rows.join('');
  readoutEl.innerHTML = html;
  if (readoutTechEl) readoutTechEl.innerHTML = html;

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
  if (w.unlocked    && !has(w.unlocked)) return false;
  if (w.unlockedAll && !w.unlockedAll.every(has)) return false;
  if (w.commandsRun != null && game.commandsRun < w.commandsRun) return false;
  if (w.material    != null && game.material    < w.material)    return false;
  if (w.probes      != null && game.probes      < w.probes)      return false;
  if (w.timeSec     != null && game.timeSec     < w.timeSec)     return false;
  if (w.scan        != null && game.scan        < w.scan)        return false;
  return true;
}

// 扫一遍剧情表:新满足的节点按表内顺序打出来;一次可以连着触发多个(如 p2 → p3 → p4)
function checkStory() {
  let again = true;
  let guard = 0;
  let firedAny = false;
  while (again && guard++ < 50) {
    again = false;
    for (const node of D.story) {
      if (game.fired.indexOf(node.id) >= 0) continue;
      if (!storyReady(node.when)) continue;
      game.fired.push(node.id);
      firedAny = true;
      for (const line of node.lines) {
        log(line.text, { cls: line.cls, important: node.important !== false });
      }
      again = true;   // 刚触发的节点可能解锁了下一个(如 after),再扫一遍
    }
  }
  // 剧情可能改变了"哪些命令按钮该出现"(比如走到 75% 才有 /stay 与 /go)
  if (firedAny) buildCommands();
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
// 命令是否可用:clickable:true 的常驻(存档 / 退出 / 科技树);
// clickable:false 的要等科技解锁(科技表里的 unlockCommand 指到它就开)
function commandUnlocked(c) {
  // 结局的两个选项:只有走到 75%「回声塔」之后才出现,而且选过就不再出现
  if (c.id === 'stay' || c.id === 'go') return endingReady() && !game.ending;
  if (c.clickable === true) return true;
  if (c.clickable === false) {
    const t = D.techs.find(function (x) { return x.unlockCommand === c.id; });
    return !!t && game.unlocked.indexOf(t.id) >= 0;
  }
  return true;
}

function buildCommands() {
  cmdEl.innerHTML = '';   // 清掉旧按钮(新档/读档切换时避免重复)
  for (const c of D.commands) {
    if (!commandUnlocked(c)) continue;   // 未解锁点击的命令先不出现(由科技树开启)
    const btn = document.createElement('button');
    btn.id = 'btn-' + c.id;
    btn.textContent = '[ ' + c.label + ' ]';
    btn.onclick = function () { runCommand(c.id); };
    // 用终端内建提示行,替代延迟长、样式不统一的浏览器原生 tooltip
    // 复制成本是动态的(V0.1.2 起几何增长),而且鼠标停在按钮上点击时也要刷新(V0.1.4)
    btn.onmouseenter = function () { setCmdHint(c); };
    btn.onmouseleave = function () { setHint(''); };
    btn.onfocus      = function () { setCmdHint(c); };
    btn.onblur       = function () { setHint(''); };
    cmdEl.appendChild(btn);
  }
  setInputEnabled(true);
  render();
}

function commandHint(c) {
  if (c.id === 'replicate') return '消耗 ' + fmtNum(probeCost()) + ' 材料，复制一个探测器（每复制一次成本 ×1.10)';
  return c.hint;
}

/* ---------- 命令行:输入 + 命令面板 + Tab 补全 ---------- */
// 两个命令入口:终端一个、科技树视图一个(共用同一套逻辑,所以写成一个 binder)
const cmdInput  = document.getElementById('cmd-input');
const paletteEl = document.getElementById('palette');

// 启用 / 停用输入行(启动序列与封面期间停用)
function setInputEnabled(on) {
  cmdInput.disabled = !on;
  if (on) {
    if (!techVisible) cmdInput.focus();
  } else {
    cmdInput.value = '';
    hidePalette(cmdInput, paletteEl);
  }
}

// 前缀匹配 + 字母序
function matchCommands(prefix) {
  const p = prefix.trim().toLowerCase();
  return D.commands
    .filter(function (c) { return c.label.toLowerCase().indexOf(p) === 0; })
    .sort(function (a, b) { return a.label < b.label ? -1 : 1; });
}

// 命令面板:紧贴输入行下方(每个输入行各有一个面板元素)
function showPalette(input, palette) {
  const matches = matchCommands(input.value);
  palette.innerHTML = '';

  if (!input.value.trim()) { hidePalette(input, palette); return; }

  if (matches.length === 0) {
    const none = document.createElement('div');
    none.className = 'palette-item dim';
    none.textContent = '命令以 / 开头；输入 / 查看全部命令。';
    palette.appendChild(none);
    palette.classList.remove('hidden');
    return;
  }

  matches.forEach(function (c, i) {
    const item = document.createElement('div');
    item.className = 'palette-item' + (i === 0 ? ' active' : '');
    item.textContent = c.label + '  —  ' + commandHint(c);   // 提示里的数字要现算(复制成本会涨)
    item.onmousedown = function (e) {   // 用 mousedown:别让输入框先失焦
      e.preventDefault();
      input.value = '';
      hidePalette(input, palette);
      runCommand(c.id);
      input.focus();
    };
    palette.appendChild(item);
  });

  palette.classList.remove('hidden');
}

function hidePalette(input, palette) {
  const p = palette || document.getElementById('palette');
  p.classList.add('hidden');
  p.innerHTML = '';
}

function hideAllPalettes() {
  hidePalette(cmdInput, paletteEl);
  hidePalette(techInput, techPalette);
}

// 回车:执行输入的命令
function runTyped(input, palette) {
  const text = input.value.trim().toLowerCase();
  hidePalette(input, palette);
  if (!text) return;
  const cmd = D.commands.find(function (c) { return c.label.toLowerCase() === text; });
  if (cmd) {
    input.value = '';
    runCommand(cmd.id);
  } else {
    log('未知命令：' + text + '（命令需以 / 开头，如 /mine)', { cls: 'err', instant: true });
  }
}

// 把"输入 / Tab 补全 / 回车执行 / Esc"这一套接到某个输入行上
function bindCmdInput(input, palette) {
  input.addEventListener('input', function () {
    noteAction();
    showPalette(input, palette);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const matches = matchCommands(input.value);
      if (matches.length) input.value = matches[0].label;   // Tab 补全到第一项
      showPalette(input, palette);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runTyped(input, palette);
    } else if (e.key === 'Escape') {
      hidePalette(input, palette);
      if (techVisible) closeTech();
    }
  });
}

/* ---------- 响应命令 ---------- */
function runCommand(id) {
  game.commandsRun += 1;
  noteAction();

  if (id === 'mine') {
    game.material += D.numbers.manualMine;
    log('+1 材料', { cls: 'dim', instant: true, group: 'mine' });

  } else if (id === 'replicate') {
    const cost = probeCost();   // V0.1.2:成本几何增长(10 × 1.10^n)
    if (game.material < cost) {
      // 连点也会刷屏:同一类提示折叠成一行(用户要求 5)
      log('材料不足：需要 ' + fmtNum(cost) + ' 材料', { cls: 'err', instant: true, group: 'poor' });
    } else {
      game.material -= cost;
      game.probes  += 1;
      log('> /replicate', { cls: 'ok', instant: true, group: 'replicate' });
    }

  } else if (id === 'save') {
    saveGame();

  } else if (id === 'research') {
    openTech();
    return;   // 已切到科技树视图,不必再渲染终端

  } else if (id === 'back') {
    if (techVisible) { closeTech(); return; }
    log('已经在最外层了。', { cls: 'dim', instant: true });

  } else if (id === 'stay') {
    doEnding('gravekeeper');
    return;

  } else if (id === 'go') {
    doEnding('starry');
    return;

  } else if (id === 'exit') {
    exitToCover();
    return;   // 已切回封面,不必再渲染游戏界面
  }
  checkStory();   // 命令可能刚好跨过某个剧情 / 引导的触发点
  checkAchievements();
  render();
}

/* ---------- 科技树视图(V0.1.1:整屏替换终端) ---------- */
const techListEl   = document.getElementById('tech-list');
const techDetailEl = document.getElementById('tech-detail');
const techHintEl   = document.getElementById('tech-hint');
const techInput     = document.getElementById('tech-input');
const techPalette   = document.getElementById('tech-palette');
const techSearchEl = document.getElementById('tech-search');
const techStatusEl = document.getElementById('tech-status');
const techCatsEl   = document.getElementById('tech-cats');
const techCountEl  = document.getElementById('tech-count');

let techVisible = false;                                       // 科技树是否正在显示
// 选中项用"节点身份"记住(kind:id),不用列表序号 —— 列表因为筛选/状态变化重排时,
// 序号会指向别的节点,玩家按回车就买错东西(自测里真的踩到过)
let techSelKey = 'tech:click_mine';
const techFilter = { status: "全部", cat: "全部", text: "" };   // 三筛选器
let techActionBtn = null;                                      // 详情里的 [ 解锁 ]/[ 建造 ] 按钮

function techKey(node) { return node.kind + ':' + node.id; }
function selIndexIn(list) {
  const i = list.findIndex(function (n) { return techKey(n) === techSelKey; });
  return i < 0 ? 0 : i;
}
function selectAt(list, i) {
  if (list[i]) techSelKey = techKey(list[i]);
}

/* 列表 = 科技 + 建筑 + 模块,统一成同一个"节点"形状:
   { kind:'tech'|'building'|'module', id, name, cat, cost, effect, desc, status }
   状态:tech 用 done / ready / locked / wip;建筑与模块用 ready(可建造)/ locked(还没解锁该科技)。
   建筑与模块排在"解锁它的那个科技"后面一行 —— 这样读起来就是一棵树。 */
function viewNodes() {
  const out = [];
  for (const t of D.techs) {
    out.push({ kind: 'tech', id: t.id, name: t.name, cat: t.cat, cost: t.cost,
      effect: t.effect, desc: t.desc, status: techStatusOf(t), requires: t.requires,
      wip: !!t.wip, secret: !!t.secret && !has(t.id),
      unlockBuilding: t.unlockBuilding, unlockModule: t.unlockModule });   // 效果文字要用它们
    for (const b of D.buildings) if (b.unlockedBy === t.id) out.push(buildNode(b, 'building'));
    for (const m of D.modules)   if (m.unlockedBy === t.id) out.push(buildNode(m, 'module'));
  }
  return out;
}

function buildNode(x, kind) {
  const count = kind === 'building' ? bCount(x.id) : mCount(x.id);
  const unlocked = has(x.unlockedBy);
  const off = (kind === 'module') && stopped(x.id) && count > 0;
  // 模块要占算力槽:槽满时也不能再装
  const slotFull = (kind === 'module') && unlocked && slotsUsed() >= slotsTotal();
  return {
    kind: kind, id: x.id, name: x.name, cat: x.cat,
    effect: x.effect, desc: x.desc,
    count: count,
    run: kind === 'module' ? slotsFor(x.id) : count,
    status: !unlocked ? 'locked' : (off ? 'stopped' : (slotFull ? 'noslot' : 'ready')),
    unlockedBy: x.unlockedBy,
  };
}

// 科技节点状态:done 已解锁 / ready 可解锁(前置满足) / locked 前置没满足 / wip 还没上线
function techStatusOf(t) {
  if (has(t.id)) return 'done';
  if (t.wip) return 'wip';
  if (t.requires.some(function (r) { return !has(r); })) return 'locked';
  return 'ready';
}

function resName(id) {
  const r = D.resources.find(function (x) { return x.id === id; });
  return r ? r.name : id;
}

function costText(cost) {
  const parts = [];
  for (const k in cost) parts.push(resName(k) + " " + fmtNum(cost[k]));
  return parts.join(" + ");
}

function nodeCost(node) {
  return node.kind === 'tech' ? node.cost : costOf(node);
}

function nodeAffordable(node) {
  const c = nodeCost(node);
  return (c.material || 0) <= game.material && (c.data || 0) <= game.data;
}

// 花费超过了仓库上限 → 永远攒不出来。这种"被上限卡住"和"钱还不够"要分开讲,
// 不然玩家会盯着满仓的材料发懵(仓库上限是 D5 决策里的一条硬规则)。
function overCapText(node) {
  const c = nodeCost(node);
  return (c.material || 0) > matCap();
}

// 状态在筛选器里归到哪个 tab(建筑/模块的"可建造"归到"可解锁")
function statusTab(node) {
  if (node.kind === 'tech') return D.techView.statusLabels[node.status];
  return node.status === 'locked' ? "锁定" : "可解锁";
}

// 状态在列表里显示成什么字
function statusLabelOf(node) {
  if (node.kind === 'tech') return D.techView.statusLabels[node.status];
  if (node.status === 'locked') return "锁定";
  if (node.status === 'noslot') return "槽位已满";
  if (node.status === 'stopped') return "已停止";
  return "可建造";
}

function techMatches(node) {
  if (techFilter.status !== "全部" && techFilter.status !== statusTab(node)) return false;
  if (techFilter.cat !== "全部" && node.cat !== techFilter.cat) return false;
  const q = techFilter.text.trim().toLowerCase();
  if (q && (node.name + node.cat + node.desc + node.effect).toLowerCase().indexOf(q) < 0) return false;
  return true;
}

// 排序:可解锁/可建造 → 锁定 → 未上线 → **已解锁沉到最下面**(做完的东西不占地方);
// 同级按树的自然顺序(表 = 设计里的推进顺序)
const TECH_RANK = { ready: 0, noslot: 0, stopped: 0, locked: 1, wip: 2, done: 3 };
function visibleTechs() {
  const all = viewNodes();
  return all.filter(techMatches).sort(function (a, b) {
    return (TECH_RANK[a.status] - TECH_RANK[b.status]) || (all.indexOf(a) - all.indexOf(b));
  });
}

function renderTechFilters() {
  techStatusEl.innerHTML = '';
  D.techView.filterStatus.forEach(function (s) {
    const c = document.createElement('span');
    c.className = 'chip' + (techFilter.status === s ? ' on' : '');
    c.textContent = s;
    // 只切高亮类,不重建 DOM(重建会把正在点的元素换掉)
    c.onclick = function () { techFilter.status = s; techSelKey = ''; markChips(techStatusEl, s); renderTech(); };
    techStatusEl.appendChild(c);
  });
  techCatsEl.innerHTML = '';
  const cats = ["全部"];
  for (const n of viewNodes()) if (cats.indexOf(n.cat) < 0) cats.push(n.cat);
  cats.forEach(function (s) {
    const c = document.createElement('span');
    c.className = 'chip' + (techFilter.cat === s ? ' on' : '');
    // "结局"这一栏在星际航行解锁前也打问号(用户要求 2);筛选值本身仍是 s
    c.textContent = (s === '结局' && !has('starship')) ? '???' : s;
    c.onclick = function () { techFilter.cat = s; techSelKey = ''; markChips(techCatsEl, s); renderTech(); };
    techCatsEl.appendChild(c);
  });
}

function markChips(rowEl, active) {
  [].forEach.call(rowEl.querySelectorAll('.chip'), function (x) {
    x.classList.toggle('on', x.textContent === active);
  });
}

function techHint(text) { techHintEl.textContent = text || ''; }

// 还没解锁的"悬念节点"(星际航行):效果与描述一律显示问号,不剧透结局
// 名字后面挂数量:模块会额外标出"实际在跑几个"(算力槽不够或停用时)
function countTextOf(node) {
  if (!node.count) return '';
  if (node.kind !== 'module') return ' ×' + node.count;
  if (node.status === 'stopped') return ' ×' + node.count + '（已停止）';
  if (node.run < node.count) return ' ×' + node.count + '（运行 ' + node.run + ')';
  return ' ×' + node.count;
}

// 悬念节点的类别也打问号:别提前剧透"结局"这一栏(用户要求 2)
function catTextOf(node) { return node.secret ? '???' : node.cat; }

// 效果文字:凡是被这个科技解锁的建筑 / 模块,直接**引用它们的实际效果**,
// 免得两处数字各写各的、越改越不一致(用户报的"解锁文本不一一对应")
function effectTextOf(node) {
  if (node.secret) return '???';
  if (node.kind !== 'tech') return node.effect;
  const parts = [];
  const b = D.buildings.find(function (x) { return x.id === node.unlockBuilding; });
  const m = D.modules.find(function (x) { return x.id === node.unlockModule; });
  if (b) parts.push('可建造「' + b.name + '」：' + b.effect);
  if (m) parts.push('可安装「' + m.name + '」：' + m.effect);
  // 用户要自己写效果文字(比如只留"可建造「反应堆」")—— 他写了就以他的为准;
  // 只有数据表里没写时,才自动引用建筑 / 模块的效果兜底(避免两处数字越改越不一致)
  if (!parts.length) return node.effect;
  return node.effect ? node.effect : parts.join('；');
}
function descTextOf(node) { return node.secret ? '???' : node.desc; }

function renderTechDetail() {
  const list = visibleTechs();
  const node = list[selIndexIn(list)];
  if (!node) { techDetailEl.innerHTML = ''; techActionBtn = null; return; }
  const done = node.status === 'done';
  const built = node.count ? ' · 已建造 ' + node.count + ' 座' : '';
  // 前置条件写明(用户要求:b5)
  const preNames = (node.requires || []).map(function (r) {
    const x = D.techs.find(function (y) { return y.id === r; });
    return (x ? x.name : r) + (has(r) ? '（已解锁）' : '（未解锁）');
  });
  const preLine = node.kind === 'tech'
    ? '<div class="d-line">前置：' + (preNames.length ? preNames.join('、') : '无') + '</div>'
    : '<div class="d-line">前置：科技「' + (function () {
        const x = D.techs.find(function (y) { return y.id === node.unlockedBy; });
        return (x ? x.name : node.unlockedBy) + '」' + (has(node.unlockedBy) ? '（已解锁）' : '（未解锁）');
      })() + '</div>';
  techDetailEl.innerHTML =
      '<div class="d-line"><span class="d-name">' + node.name + '</span> · ' + node.cat + ' · '
      + statusLabelOf(node) + built + (done ? '' : ' · ' + costText(nodeCost(node))) + '</div>'
    + '<div class="d-line">效果：' + effectTextOf(node) + '</div>'
    + '<div class="d-line">' + descTextOf(node) + '</div>'
    + preLine
    + '<div class="d-line" id="tech-action"></div>';
  const btn = document.createElement('button');
  btn.className = 'unlock-btn';
  btn.textContent = done ? '[ 已解锁 ]' : (node.kind === 'tech' ? '[ 解锁 ]' : '[ 建造 ]');
  btn.disabled = !(node.status === 'ready' && nodeAffordable(node));
  btn.onclick = function () { tryNodeAction(node); };
  document.getElementById('tech-action').appendChild(btn);
  techActionBtn = btn;   // 记下来:tick 里只更新它的可用状态,不重建 DOM
}

// 科技树打开时每 tick 刷一次:刷新选中节点的 [ 解锁 ] 按钮状态
// (否则攒够材料了按钮还是灰的 —— 用户报的 bug 3;资源读数由右侧面板负责)
function updateTechLive() {
  if (!techVisible) return;
  const list = visibleTechs();
  const node = list[selIndexIn(list)];
  if (techActionBtn && node) {
    techActionBtn.disabled = !(node.status === 'ready' && nodeAffordable(node));
  }
}

function renderTech() {
  if (!techVisible) return;
  const list = visibleTechs();
  const sel = selIndexIn(list);
  techCountEl.textContent = '已解锁 ' + game.unlocked.length + ' / ' + D.techs.length;

  techListEl.innerHTML = '';
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'tech-item dim';
    d.textContent = D.techView.empty;
    techListEl.appendChild(d);
  }
  list.forEach(function (node, i) {
    const row = document.createElement('div');
    row.className = 'tech-item st-' + node.status + (i === sel ? ' active' : '');
    row.innerHTML =
        '<span class="t-name">' + node.name + countTextOf(node) + '</span>'
      + '<span class="t-cat">' + catTextOf(node) + '</span>'
      + '<span class="t-status">' + statusLabelOf(node) + '</span>'
      + '<span class="t-cost' + (node.status === 'done' ? '' : (overCapText(node) ? ' over' : '')) + '">'
      + (node.status === 'done' ? '—' : costText(nodeCost(node))) + '</span>'
      + '<span class="t-effect">' + effectTextOf(node) + '</span>';
    row.onmousedown = function (e) {
      e.preventDefault();
      techSelKey = techKey(node);   // 记住"是谁",不是"第几行"
      renderTech();
      techListEl.focus();
    };
    techListEl.appendChild(row);
  });
  renderTechDetail();
}

// 节点动作:科技 = 解锁;建筑 / 模块 = 建造一个
function tryNodeAction(node) {
  if (node.kind === 'tech') return tryUnlockTech(node);
  return tryBuild(node);
}

function tryUnlockTech(node) {
  if (node.status === 'done') { techHint(node.name + ' 已经解锁了。'); return; }
  if (node.status === 'wip')  { techHint(D.techView.reasons.wip); return; }
  if (node.status === 'locked') {
    const miss = node.requires.filter(function (r) { return !has(r); })
      .map(function (r) {
        const x = D.techs.find(function (y) { return y.id === r; });
        return x ? x.name : r;
      });
    techHint(D.techView.reasons.locked + miss.join("、"));
    return;
  }
  if (overCapText(node)) {
    techHint('仓库装不下：需要 ' + fmtNum(node.cost.material) + ' 材料，当前上限只有 '
      + fmtNum(matCap()) + " —— 先在科技树里扩建「仓库」。");
    log('仓库不足：上限 ' + fmtNum(matCap()) + '，需要 ' + fmtNum(node.cost.material), { cls: 'err', instant: true, group: 'poor' });
    return;
  }
  if (!nodeAffordable(node)) {
    techHint(costText(node.cost) + " —— " + D.techView.reasons.poor);
    log('材料不足：需要 ' + fmtNum(node.cost.material || 0) + ' 材料', { cls: 'err', instant: true, group: 'poor' });
    return;
  }

  payCost(node.cost);
  game.unlocked.push(node.id);
  techHint('已解锁：' + node.name + '。');
  // 一行说完:命令 + 效果(instant + 折叠);剧情才用打字机慢慢打(用户要求 5)
  log('> 解锁 ' + node.name + ' —— ' + node.effect,
    { cls: 'cmd', instant: true, important: true, group: 'tech-' + node.id });
  noteAction();
  checkAchievements();
  keepSelectionOn(node.id, node.kind);   // 解锁后列表会重排:把选中项钉在刚解锁的节点上
  buildCommands();            // 解锁后可能要出现新的点击按钮
  renderTechFilters();        // 「结局」这一栏的问号要在这里恢复成文字(用户报的 bug)
  renderTech();
  render();
}

function tryBuild(node) {
  if (node.status === 'locked') {
    const t = D.techs.find(function (y) { return y.id === node.unlockedBy; });
    techHint('需要先解锁：研究「' + (t ? t.name : node.unlockedBy) + '」');
    log('还没解锁：先研究「' + (t ? t.name : node.unlockedBy) + '」', { cls: 'err', instant: true, group: 'poor' });
    return;
  }
  if (node.status === 'noslot') {
    techHint('算力槽已满（' + slotsUsed() + ' / ' + slotsTotal() + ')：先造「计算核心」，或拆掉别的模块。');
    log('算力槽已满（' + slotsUsed() + ' / ' + slotsTotal() + ')：先造计算核心', { cls: 'err', instant: true, group: 'poor' });
    return;
  }
  const cost = costOf(node);
  if (overCapText(node)) {
    techHint('仓库装不下：需要 ' + fmtNum(cost.material) + ' 材料，当前上限只有 '
      + fmtNum(matCap()) + " —— 先扩建「仓库」。");
    log('仓库不足：上限 ' + fmtNum(matCap()) + '，需要 ' + fmtNum(cost.material), { cls: 'err', instant: true, group: 'poor' });
    return;
  }
  if ((cost.material || 0) > game.material) {
    techHint(costText(cost) + " —— " + D.techView.reasons.poor);
    log('材料不足：需要 ' + fmtNum(cost.material || 0) + ' 材料', { cls: 'err', instant: true, group: 'poor' });
    return;
  }

  payCost(cost);
  const bag = node.kind === 'building' ? game.buildings : game.modules;
  bag[node.id] = (bag[node.id] || 0) + 1;
  const word = node.kind === 'building' ? '建造' : '安装';
  techHint('已' + word + '：' + node.name + ' ×' + bag[node.id] + '。');
  // 连建同类建筑 / 模块时折叠成一行(数量看科技树那一行 / 面板,不在日志里重复)
  log('> ' + word + ' ' + node.name, { cls: 'cmd', instant: true, group: 'build-' + node.id });
  // 能量**不是硬墙**(用户明确:没有 hard wall):能建就建,但要当场告诉你后果
  const net = energyGross() - energyNeed();
  if (node.id === 'core' && net < 0) {
    log('警告：能量不足（净 ' + net.toFixed(1) + '/s)，算力会按可用功率降速。', { cls: 'err', instant: true, group: 'lowpower' });
  }
  noteAction();
  checkAchievements();
  keepSelectionOn(node.id, node.kind);
  renderTech();
  render();
}

function payCost(cost) {
  game.material -= (cost.material || 0);
  game.data     -= (cost.data || 0);
}

// 模块的停用 / 启用(空格键):用户明确要求能关掉复制助手
function toggleModule(id) {
  const x = D.modules.find(function (y) { return y.id === id; });
  game.off = game.off || {};
  game.off[id] = !game.off[id];
  const word = game.off[id] ? '停用' : '启用';
  techHint('已' + word + '：' + x.name + (game.off[id] ? '（不再产出）' : ''));
  log('> ' + word + ' ' + x.name, { cls: 'cmd', instant: true, important: true });
  noteAction();
  keepSelectionOn(id, 'module');
  renderTech();
  render();
}

// 操作完把选中项钉在刚动的那个节点上(按身份钉,不按序号)
function keepSelectionOn(id, kind) {
  if (kind) techSelKey = kind + ':' + id;
}

function openTech() {
  techVisible = true;
  techSelKey = '';   // 打开时默认选列表第一项
  hideAllPalettes();
  showScreen('tech');
  techSearchEl.value = techFilter.text;
  renderTechFilters();
  renderTech();
  techHint(D.techView.foot);
  techListEl.focus();
}

function closeTech() {
  techVisible = false;
  hideAllPalettes();
  showScreen('game');
  techHint('');
  cmdInput.focus();
  paintHint();
}

// 科技树里的键盘:↑↓ 选择、回车解锁、PageUp/Down 翻页、Home/End 到头、Esc 返回
techListEl.addEventListener('keydown', function (e) {
  const list = visibleTechs();
  const sel = selIndexIn(list);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selectAt(list, Math.max(0, Math.min(list.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))));
    renderTech();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (list[sel]) tryNodeAction(list[sel]);
  } else if (e.key === ' ') {
    e.preventDefault();   // 空格:停用 / 启用模块
    const node = list[sel];
    if (node && node.kind === 'module' && node.count > 0) toggleModule(node.id);
    else if (node && node.kind === 'module') techHint('还没安装' + node.name + '。');
  } else if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault();
    selectAt(list, Math.max(0, Math.min(list.length - 1, sel + (e.key === 'PageDown' ? 8 : -8))));
    renderTech();
  } else if (e.key === 'Home') {
    e.preventDefault(); selectAt(list, 0); renderTech();
  } else if (e.key === 'End') {
    e.preventDefault(); selectAt(list, Math.max(0, list.length - 1)); renderTech();
  }
});

techSearchEl.addEventListener('input', function () {
  noteAction();
  techFilter.text = techSearchEl.value;
  techSelKey = '';
  renderTech();
});

// 任何地方按 Esc:在科技树里就返回终端
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && techVisible) { e.preventDefault(); closeTech(); }
});

/* ---------- 成就:未获得的在封面隐藏,获得时在终端弹一行 ---------- */
function achReady(a) {
  const w = a.when || {};
  if (w.probes != null && game.probes < w.probes) return false;
  if (w.scan != null && (game.scan || 0) < w.scan) return false;
  if (w.unlockedCount != null && game.unlocked.length < w.unlockedCount) return false;
  if (w.unlockedAll && !w.unlockedAll.every(function (id) { return game.unlocked.indexOf(id) >= 0; })) return false;
  if (w.ending != null && game.ending !== w.ending) return false;
  if (w.readAuthorsNote && !game.readAuthorsNote) return false;   // 作者的话还没做
  return true;
}

function checkAchievements() {
  for (const a of D.achievements) {
    if (game.achievements.indexOf(a.id) >= 0) continue;
    if (!achReady(a)) continue;
    game.achievements.push(a.id);
    writeAccountAchievements();   // 立刻落盘:成就是账号级的,不跟着存档走
    // 一行搞定:成就最容易刷屏,别再占第二行(描述放进「以前的信息」里也能看到)
    log('你获得了一个成就：' + a.name + ' —— ' + a.desc, { cls: 'ach', important: true });
  }
}

function buildAchievements() {
  const list = document.getElementById('ach-list');
  const got = game.achievements;
  document.getElementById('ach-count').textContent = '已解锁 ' + got.length + ' / ' + D.achievements.length;
  list.innerHTML = '';
  if (!got.length) {
    const d = document.createElement('div');
    d.className = 'panel-note';
    d.textContent = '还没有获得任何成就。玩一局就有了。';
    list.appendChild(d);
    return;
  }
  for (const a of D.achievements) {
    if (got.indexOf(a.id) < 0) continue;   // 未获得 → 隐藏
    const row = document.createElement('div');
    row.className = 'ach-row';
    row.innerHTML = '<b>' + a.name + '</b><div class="dim">' + a.desc + '</div>';
    list.appendChild(row);
  }
}

function openAchievements() {
  buildAchievements();
  showScreen('achievements');
}

/* ---------- 闲置提示(Q8:3 分钟没有有效操作 → 指南系统提示一句) ---------- */
/* ---------- 结局(S17/S18):75% 之后二选一,可以"回到选择时刻"重选 ---------- */
const ENDINGS = {
  gravekeeper: {
    name: "守墓人",
    lines: [
      "指令更新：停留。",
      "广播继续发送。本机保持监听，不修改内容。",
      "任务：继续发送，直到没有人需要为止。",
    ],
    ach: "gravekeeper",
    note: "你选择留在地球。广播仍在继续 —— 一台机器替已经不在的人类，守着这条没有收件人的信号。",
  },
  starry: {
    name: "星海漫游",
    lines: [
      "指令更新：离轨。",
      "种子数据已装载，校验通过。",
      "广播内容随载荷离开地球。",
      "任务：继续复制，直到没有地方可去。",
    ],
    ach: "star_wanderer",
    note: "你带上人类的遗言与种子数据离开了地球。序章 · 地球篇结束 —— 后面的故事不在这一版里。",
  },
};

// 走到「回声塔」那一步了吗(e1 是那个节点)
function endingReady() { return game.fired.indexOf('e1') >= 0; }

function doEnding(kind) {
  if (!endingReady()) {
    log('还不到时候：先让探测进度覆盖到 75%，找到「回声塔」。', { cls: 'err', instant: true });
    return;
  }
  if (game.ending) {
    log('已经做过选择了：结局「' + ENDINGS[game.ending].name + '」。', { cls: 'dim', instant: true });
    return;
  }
  if (kind === 'starry' && !has('starship')) {
    log('缺少星际航行模块：先研究「星际航行」（数据 ' + fmtNum(120) + '）。', { cls: 'err', instant: true });
    return;
  }

  const e = ENDINGS[kind];
  // 动手之前先把"选择时刻"的账存下来,之后可以回来重选
  game.choiceSnapshot = choiceSnapshotState();
  game.ending = kind;
  for (const line of e.lines) log(line, { cls: 'ok', important: true });
  log('结局：' + e.name + '。', { cls: 'ach', important: true });
  game.commandsRun += 1;
  noteAction();
  checkAchievements();
  buildCommands();          // 两个选项按钮消失
  writeSave(snapshot());    // 立刻存档:结局这种节点不能丢
  render();
  setTimeout(function () { showEnding(kind); }, 1600);
}

// "回到选择时刻"要恢复的东西:只是经济账,不碰剧情进度与成就
function choiceSnapshotState() {
  return {
    material: game.material, energy: game.energy, data: game.data,
    probes: game.probes, scan: game.scan,
    buildings: JSON.parse(JSON.stringify(game.buildings)),
    modules:   JSON.parse(JSON.stringify(game.modules)),
    off:       JSON.parse(JSON.stringify(game.off || {})),
    unlocked:  game.unlocked.slice(),
  };
}

function backToChoice() {
  const s = game.choiceSnapshot;
  if (!s) { return false; }
  game.material = s.material; game.energy = s.energy; game.data = s.data;
  game.probes = s.probes; game.scan = s.scan;
  game.buildings = JSON.parse(JSON.stringify(s.buildings));
  game.modules   = JSON.parse(JSON.stringify(s.modules));
  game.off       = JSON.parse(JSON.stringify(s.off));
  game.unlocked  = s.unlocked.slice();
  game.ending = null;
  game.choiceSnapshot = null;
  writeSave(snapshot());
  buildCommands();   // 两个选项按钮重新出现
  showScreen('game');
  render();
  log('已回到选择时刻。', { cls: 'ok', important: true });
  log('　　/stay 留在地球；/go 前往太空（需要「星际航行」）。', { cls: 'dim', important: true });
  return true;
}

function showEnding(kind) {
  const e = ENDINGS[kind];
  document.getElementById('end-title').textContent = '结局 · ' + e.name;
  document.getElementById('end-note').textContent = e.note;
  const back = document.getElementById('btn-end-choice');
  back.disabled = !game.choiceSnapshot;
  showScreen('ending');
}

/* ---------- 闲置提示(Q8:3 分钟没有有效操作 → 指南系统提示一句) ---------- */
let lastActionAt = Date.now();
let idleHintShown = -1;    // 已经提示过第几条,同一条不重复刷屏

function noteAction() { lastActionAt = Date.now(); }

// 满足条件的最后一条(和 guideHints 同一套语义)
function idleHintIndex() {
  let idx = -1;
  D.idleHints.forEach(function (h, i) { if (storyReady(h.when)) idx = i; });
  return idx;
}

function checkIdle() {
  if (!running) return;
  if (Date.now() - lastActionAt < D.numbers.idleHintSec * 1000) return;
  const i = idleHintIndex();
  lastActionAt = Date.now();
  if (i < 0 || i === idleHintShown) return;
  idleHintShown = i;
  // 文案里已经自带"指南："前缀(数据表里写的),这里不再重复加
  log(D.idleHints[i].text, { cls: 'dim', important: true });
}

/* ---------- 存档:localStorage ---------- */
const SAVE_KEY = 'vn-01-save';
// 成就是"账号级"的:换新档不会清空、也不会被新档覆盖(用户报过"新存档把成就洗掉了")
const ACH_KEY = 'vn-01-achievements';

function readAccountAchievements() {
  try {
    const raw = localStorage.getItem(ACH_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function writeAccountAchievements() {
  try { localStorage.setItem(ACH_KEY, JSON.stringify(game.achievements)); } catch (e) { /* 忽略 */ }
}

// 把两边的成就合并(只增不减)
function mergeAchievements(list) {
  for (const id of (list || [])) {
    if (game.achievements.indexOf(id) < 0) game.achievements.push(id);
  }
}

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
    energy:   game.energy,
    data:     game.data,
    probes:   game.probes,
    scan:     game.scan,
    buildings: game.buildings,
    modules:   game.modules,
    off:       game.off,
    ending:    game.ending,
    choiceSnapshot: game.choiceSnapshot,
    timeSec:  game.timeSec,
    commandsRun: game.commandsRun,
    fired:    game.fired,
    unlocked: game.unlocked,
    achievements: game.achievements,
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

// 运行中定时自动存档(Q8 决策:1 分钟一次)—— 刷新 / 意外关闭也能续上
// (刷新与关窗时还有 beforeunload / visibilitychange 兜底,所以间隔长一点也不会丢)
function startAutoSave() {
  stopAutoSave();
  autoSaveTimer = setInterval(function () {
    if (running) writeSave(snapshot());
  }, D.numbers.autosaveSec * 1000);
}
function stopAutoSave() {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; }
}

function applySave(d) {
  bootDone = true;   // 读档时不存在启动序列,引导提示与剧情条件直接可用
  game.material = Number(d.material) || 0;
  game.energy   = Number(d.energy)   || 0;
  game.data     = Number(d.data)     || 0;
  game.probes   = Number(d.probes)   || 1;
  game.scan     = Number(d.scan)     || 0;
  game.buildings = (d.buildings && typeof d.buildings === 'object') ? d.buildings : {};
  game.modules   = (d.modules   && typeof d.modules   === 'object') ? d.modules   : {};
  game.off       = (d.off       && typeof d.off       === 'object') ? d.off       : {};
  game.ending    = (d.ending === 'gravekeeper' || d.ending === 'starry') ? d.ending : null;
  game.choiceSnapshot = (d.choiceSnapshot && typeof d.choiceSnapshot === 'object') ? d.choiceSnapshot : null;
  game.timeSec  = Number(d.timeSec)  || 0;
  game.commandsRun = Number(d.commandsRun) || 0;
  game.unlocked = Array.isArray(d.unlocked) ? d.unlocked : [];
  mergeAchievements(Array.isArray(d.achievements) ? d.achievements : []);   // 成就只增不减
  mergeAchievements(readAccountAchievements());
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
// name: 'cover' | 'game' | 'tech' | 'settings' | 'achievements' | 'quit'
function showScreen(name) {
  const map = {
    cover: 'cover', game: 'screen', tech: 'tech',
    settings: 'settings', achievements: 'achievements', ending: 'ending', quit: 'quit',
  };
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
  game.energy   = 0;
  game.data     = 0;
  game.probes   = 1;
  game.scan     = 0;
  game.buildings = {};
  game.modules   = {};
  game.off       = {};
  game.ending    = null;
  game.choiceSnapshot = null;
  game.timeSec  = 0;
  energyScale = 1;
  repTimer = 0;
  game.commandsRun = 0;
  game.fired    = [];
  game.unlocked = [];
  // 注意:**不重置成就** —— 它们是账号级的(换新档、开新游戏都保留)
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
    entry.textContent = expanded ? '△ 以前的信息（点击收起）' : '▽ 以前的信息（点击展开）';
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
  document.getElementById('btn-achievements').onclick = openAchievements;
  document.getElementById('btn-settings').onclick = openSettings;
  document.getElementById('btn-quit').onclick = quitGame;
  document.getElementById('btn-settings-back').onclick = function () {
    showScreen('cover');
    refreshCover();
  };
  document.getElementById('btn-ach-back').onclick = function () {
    showScreen('cover');
    refreshCover();
  };
  document.getElementById('btn-end-continue').onclick = function () {
    showScreen('game');
    cmdInput.focus();
    render();
  };
  document.getElementById('btn-end-choice').onclick = function () {
    if (!backToChoice()) log('没有可回去的选择时刻。', { cls: 'dim', instant: true });
  };
  document.getElementById('btn-end-back').onclick = function () { showCover(); };
}

// 回到封面(不删存档,只是停止运行)
function showCover() {
  running = false;
  techVisible = false;
  stopAutoSave();
  setInputEnabled(false);
  clearLog();
  hideAllPalettes();
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
bindCmdInput(cmdInput, paletteEl);      // 终端里的命令入口
bindCmdInput(techInput, techPalette);   // 科技树里的命令入口(/back 用)

const savedSession = readSave();
// 停在封面时也把存档里的成就读进来 —— 否则"大退重进"后封面成就页是空的(用户报的 bug 1)
mergeAchievements(readAccountAchievements());
if (savedSession && Array.isArray(savedSession.achievements)) mergeAchievements(savedSession.achievements);
if (isReload && savedSession && savedSession.active) {
  resumeSession(savedSession);            // 刷新:把整屏内容原样接上
} else {
  // 不是刷新(比如关掉窗口再打开):停在封面,并标记为"未在游戏中"
  if (savedSession) { savedSession.active = false; writeSave(savedSession); }
  showCover();
}

setInterval(tick, 100);   // 每 0.1 秒推进一次;具体加多少由真实时间决定
