/* ============================================================
   tools/economy-sim.js —— 星海漫游「经济与节奏」模拟器

   ⚠ 这不是游戏的一部分:浏览器不会加载它,双击 index.html 也不需要它。
   它是开发工具,用来把"数值改成多少"从拍脑袋变成可复算的计算。

   它模拟的东西(与 docs/research.md 第 10–19 节的设计一一对应):
     材料(存量,受仓库上限) / 能量(存量+上限,节流) / 算力(槽位) / 数据(研究货币)
     探测器、仓库、反应堆、计算核心、模块(采集助手 / 解析器 / 复制助手)
     14 项科技(含长距离通信、星际航行)
     星球探测进度(探测器越多越快,覆盖率越高越难扫;未解锁长距离通信时 ×0.2)
     剧情节点(挂在探测进度 / 科技解锁上)

   用法(需要 Node.js,任意目录):
     node tools/economy-sim.js                  # 完整报告:科技时间线 + 剧情节点间隔 + 逐分钟快照
     node tools/economy-sim.js curve 0.008      # 每一度探测进度的时间(1% 一档)
     node tools/economy-sim.js curve 0.008 "2,8,13,40,52,64,75"   # 指定剧情阈值,算最大空窗
     node tools/economy-sim.js search           # 扫一遍 scanK,看曲线怎么变
     node tools/economy-sim.js 0.009            # 用别的 scanK 跑完整报告

   改参数:只改下面的 P(数值)与 TECHS(科技)与 BEATS(剧情节点)。
   验收口径:① 科技在 13~15 分钟走完 ② 探测 100% 在 14:30 左右
             ③ 相邻剧情节点的间隔 ≤ 180 秒(硬指标,见 docs/research.md 第 19 节)
   ============================================================ */

const P = {
  // ---- 材料层 ----
  probeOutput: 0.5,      // 每台探测器 材料/秒
  probeBaseCost: 10,     // 第一台的成本(之后 ×probeGrowth)
  probeGrowth: 1.10,     // 探测器成本增长 r(D3 决策:先取 1.10)

  // ---- 能量层 ----
  reactorCost: 120, reactorGrowth: 1.18,
  reactorRate: 2.0,      // 能量/秒/台
  reactorCap: 80,        // 每台提供的能量上限

  // ---- 算力层(槽位) ----
  coreCost: 260, coreGrowth: 1.18, coreDrain: 1.5, coreSlots: 1,

  // ---- 模块(各占 1 算力槽) ----
  droneCost: 60,  droneGrowth: 1.12, droneRate: 1.5,     // 采集助手
  decoderCost: 90, decoderGrowth: 1.12, decoderRate: 0.2, // 解析器 → 数据
  repCost: 200, repGrowth: 1.15, repEvery: 4,            // 复制助手:每 4 秒自动复制

  // ---- 仓库:材料必须有地方放(D5 灵感 5) ----
  whCost: 120, whGrowth: 1.16, whBaseCap: 200, whCapMul: 1.6,

  // ---- 星球探测进度(灵感 1) ----
  // 速率系数(命令行第一个参数是数字时才当作 scanK,否则用默认值)
  scanK: Number.isFinite(Number(process.argv[2])) ? Number(process.argv[2]) : 0.008,
  scanFalloff: 200,      // 覆盖率衰减:速率 × (1 − 进度/200)
  scanNoCommMul: 0.2,    // 未解锁长距离通信:只能扫基地附近

  // ---- 玩家行为模型 ----
  manualMineSec: 90,     // 前 90 秒按 1 次/秒手动 /mine
  dt: 0.1, horizon: 1800,
};

// 科技表(顺序 = 玩家模型的购买顺序;货币分工见 D8:点击/硬件用材料,自动化/倍率用数据)
const TECHS = [
  { id: 'click_mine', cost: { material: 40 } },   // 手动控制
  { id: 'click_rep',  cost: { material: 140 } },  // 批量复制
  { id: 'reactor',    cost: { material: 320 } },  // 反应堆
  { id: 'core',       cost: { material: 620 } },  // 计算核心
  { id: 'decode',     cost: { material: 560 } },  // 信号解析
  { id: 'drone',      cost: { data: 3 } },        // 无人采集
  { id: 'comm',       cost: { data: 6 } },        // 长距离通信(解除探测 ×0.2 的限制)
  { id: 'autorep',    cost: { data: 10 } },       // 自主复制
  { id: 'probe_eff',  cost: { data: 16 } },       // 复制优化 ×1.5
  { id: 'core_eff',   cost: { data: 26 } },       // 并行调度:槽 ×2、耗能 ×0.8
  { id: 'decode_eff', cost: { data: 38 } },       // 语义重构:解析 ×1.6
  { id: 'fusion',     cost: { data: 55 } },       // 聚变改良:反应堆 ×1.6
  { id: 'bootstrap',  cost: { data: 85 } },       // 递归自举:探测器 ×2
  { id: 'starship',   cost: { data: 120 } },      // 星际航行(结局"前往太空"的前置)
];

// 剧情节点:挂在探测进度上;tech 型节点挂在科技解锁上
const BEATS = [
  { id: 'b0', label: '残片 001(第一次复制,现有节点)' },
  { id: 'b1', scan: 2 }, { id: 'b2', scan: 8 },
  { id: 'b3', scan: 13, note: '本地扫完 → 提示需要长距离通信' },
  { id: 'b4', tech: 'comm', note: '长距离通信解锁(机器侧)' },
  { id: 'b5', scan: 40 }, { id: 'b6', scan: 52 }, { id: 'b7', scan: 64 },
  { id: 'b8', scan: 75, note: '找到发射器' },
  { id: 'b9', scan: 100, note: '地球篇结束' },
];

const probeCost   = (n) => P.probeBaseCost * Math.pow(P.probeGrowth, n);
const reactorCost = (n) => P.reactorCost   * Math.pow(P.reactorGrowth, n);
const coreCost    = (n) => P.coreCost      * Math.pow(P.coreGrowth, n);
const droneCost   = (n) => P.droneCost     * Math.pow(P.droneGrowth, n);
const decoderCost = (n) => P.decoderCost   * Math.pow(P.decoderGrowth, n);
const repCost     = (n) => P.repCost       * Math.pow(P.repGrowth, n);
const whCost      = (n) => P.whCost        * Math.pow(P.whGrowth, n);
const matCap      = (n) => P.whBaseCap     * Math.pow(P.whCapMul, n);

function newState() {
  return {
    t: 0, material: 0, data: 0, probes: 1, warehouses: 0,
    reactors: 0, cores: 0, energy: 0, drones: 0, decoders: 0, reps: 0,
    scan: 0, capped: false, scanAt: {}, beats: {}, unlocked: {},
    manualLeft: P.manualMineSec, repTimer: 0, cumData: 0,
    probeMul: 1, slotMul: 1, reactorMul: 1, drainMul: 1, decodeMul: 1,
    log: [], snap: {},
  };
}

const aff = (s, c) => (c.material || 0) <= s.material && (c.data || 0) <= s.data;
const pay = (s, c) => { s.material -= (c.material || 0); s.data -= (c.data || 0); };
const slotsUsed = (s) => s.drones + s.decoders + s.reps;
const nextTech = (s) => TECHS.find((t) => !s.unlocked[t.id]);

function applyTech(s, id) {
  if (id === 'decode') s.hasDecode = true;
  if (id === 'drone') s.hasDrone = true;
  if (id === 'autorep') s.hasRep = true;
  if (id === 'probe_eff') s.probeMul *= 1.5;
  if (id === 'core_eff') { s.slotMul = 2; s.drainMul = 0.8; }
  if (id === 'decode_eff') s.decodeMul *= 1.6;
  if (id === 'fusion') s.reactorMul = 1.6;
  if (id === 'bootstrap') s.probeMul *= 2;
}

function physical(s, dt) {
  if (s.manualLeft > 0) s.manualLeft -= dt;
  const manual = s.manualLeft > 0 ? 1 : 0;
  const cap = matCap(s.warehouses);
  const matRate = s.probes * P.probeOutput * s.probeMul + manual + s.drones * P.droneRate;
  s.material = Math.min(s.material + matRate * dt, cap);
  s.capped = s.material >= cap - 1e-9 && matRate > 0;

  const gross = s.reactors * P.reactorRate * s.reactorMul;
  const need = s.cores * P.coreDrain * s.drainMul;
  const eCap = s.reactors * P.reactorCap;
  const usable = Math.min(s.energy / dt + gross, need);
  const scale = need > 0 ? usable / need : 0;
  s.energy = Math.min(Math.max(s.energy + (gross - usable) * dt, 0), eCap);
  const slots = Math.floor(s.cores * P.coreSlots * s.slotMul * scale);

  if (s.hasDecode) {
    const d = s.decoders * P.decoderRate * s.decodeMul * dt;
    s.data += d; s.cumData += d;
  }
  if (s.hasRep && s.reps > 0) {
    s.repTimer += dt * s.reps;
    while (s.repTimer >= P.repEvery) {
      s.repTimer -= P.repEvery;
      const c = probeCost(s.probes - 1);
      if (s.material >= c) { s.material -= c; s.probes += 1; }
    }
  }
  const scanMul = s.unlocked.comm ? 1 : P.scanNoCommMul;
  const falloff = Math.max(0.25, 1 - s.scan / P.scanFalloff);
  s.scan = Math.min(s.scan + s.probes * P.scanK * scanMul * falloff * dt, 100);

  return { matRate, gross, need, slots, scale, cap };
}

// 玩家模型:先科技 → 补仓库 → 补能量/核心 → 装模块 → 剩下的钱买探测器
function decide(s, ph) {
  const tech = nextTech(s);
  if (tech && aff(s, tech.cost) && s.t > 2) {
    pay(s, tech.cost); s.unlocked[tech.id] = s.t; applyTech(s, tech.id);
    s.log.push([s.t, 'tech', tech.id]); return;
  }
  const net = ph.gross - ph.need, free = ph.slots - slotsUsed(s);
  const needMat = tech ? (tech.cost.material || 0) : 0;
  const underCap = needMat > matCap(s.warehouses) * 0.9;   // 目标买不起 → 先扩仓库

  if ((s.capped || underCap) && s.material >= whCost(s.warehouses)
      && matCap(s.warehouses) < 20000 && s.t > 10) {
    s.material -= whCost(s.warehouses); s.warehouses += 1;
    s.log.push([s.t, 'wh', 'warehouse' + s.warehouses]); return;
  }
  if (free <= 0 && s.unlocked.core) {
    if (net >= (s.cores + 1) * P.coreDrain * s.drainMul) {
      if (s.material >= coreCost(s.cores)) {
        s.material -= coreCost(s.cores); s.cores += 1; s.log.push([s.t, 'bld', 'core' + s.cores]); return;
      }
    } else if (s.material >= reactorCost(s.reactors)) {
      s.material -= reactorCost(s.reactors); s.reactors += 1; s.log.push([s.t, 'bld', 'reactor' + s.reactors]); return;
    }
  }
  if (s.unlocked.core && net < P.coreDrain * s.drainMul && s.reactors <= s.cores + 1
      && s.material >= reactorCost(s.reactors) * 1.2) {
    s.material -= reactorCost(s.reactors); s.reactors += 1; s.log.push([s.t, 'bld', 'reactor' + s.reactors]); return;
  }
  if (free > 0) {
    const wantData = s.hasDecode && tech && (tech.cost.data || 0) > 0 && s.data < (tech.cost.data || 0);
    if (wantData && s.material >= decoderCost(s.decoders)) {
      s.material -= decoderCost(s.decoders); s.decoders += 1; s.log.push([s.t, 'mod', 'decoder' + s.decoders]); return;
    }
    if (s.hasDrone && s.drones < 12 && s.material >= droneCost(s.drones)) {
      s.material -= droneCost(s.drones); s.drones += 1; s.log.push([s.t, 'mod', 'drone' + s.drones]); return;
    }
  }
  if (s.material > probeCost(s.probes - 1) * 1.8 && s.material >= probeCost(s.probes - 1)) {
    s.material -= probeCost(s.probes - 1); s.probes += 1;
  }
}

function run() {
  const s = newState();
  s.beats.b0 = 30;
  let nextSnap = 60;
  while (s.t < P.horizon) {
    const ph = physical(s, P.dt);
    decide(s, ph);
    s.t += P.dt;
    for (const b of BEATS) {
      if (b.scan != null && !s.beats[b.id] && s.scan >= b.scan) s.beats[b.id] = s.t;
      if (b.tech != null && !s.beats[b.id] && s.unlocked[b.tech]) s.beats[b.id] = s.unlocked[b.tech];
    }
    const step = Math.floor(s.scan);
    if (!s.scanAt[step]) s.scanAt[step] = s.t;
    if (s.t >= nextSnap) {
      s.snap[Math.round(nextSnap)] = {
        mat: s.material, cap: ph.cap, rate: ph.matRate, probes: s.probes, wh: s.warehouses,
        scan: s.scan, data: s.data, slots: ph.slots, drones: s.drones, decoders: s.decoders,
      };
      nextSnap += 60;
    }
  }
  return s;
}

const mmss = (x) => x == null ? '  —  ' : Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0');

// ---------------- 输出 ----------------
const mode = process.argv[2];

if (mode === 'search') {
  console.log('scanK 扫描(其余参数不变):扫描越快,探测 100% 越早');
  for (const k of [0.004, 0.006, 0.008, 0.010, 0.012]) {
    P.scanK = k;
    const x = run();
    console.log('  scanK=' + k.toFixed(3) + '  40%@' + mmss(x.scanAt[40]) + '  75%@' + mmss(x.scanAt[75]) +
      '  100%@' + mmss(x.scanAt[100]) + '  科技走完@' + mmss(x.unlocked.bootstrap));
  }
  process.exit(0);
}

if (mode === 'curve') {
  P.scanK = Number(process.argv[3] || P.scanK);
  const x = run();
  console.log('scanK = ' + P.scanK);
  console.log('每 2% 探测进度的时间:' + [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    .map((p) => p + '%@' + mmss(x.scanAt[p])).join('  '));
  const defTh = BEATS.filter((b) => b.scan != null).map((b) => b.scan).join(',');
  const th = (process.argv[4] || defTh).split(',').map(Number);
  let prevT = 30, maxGap = 0, worst = '';
  console.log('剧情阈值 → 时刻 / 间隔:');
  for (const p of th) {
    const t = x.scanAt[p];
    if (t == null) { console.log('  探测 ' + p + '%  → 未达到'); continue; }
    const gap = t - prevT;
    if (gap > maxGap) { maxGap = gap; worst = p + '%'; }
    console.log('  探测 ' + String(p).padStart(3) + '%  →  ' + mmss(t).padStart(6) + '   间隔 ' + mmss(gap));
    prevT = t;
  }
  console.log('  最大空窗(不含 tech 型节点)= ' + maxGap.toFixed(0) + 's (' + worst + ')');
  process.exit(0);
}

const s = run();
console.log('scanK =', P.scanK);
console.log('\n【科技时间线】');
console.log('  ' + TECHS.map((t) => t.id + ' ' + mmss(s.unlocked[t.id])).join('   '));
console.log('\n【探测进度 → 剧情节点】(硬指标:相邻间隔 ≤ 180 秒)');
let prev = s.beats.b0, maxGap = 0, maxPair = '';
for (const b of BEATS) {
  const t = s.beats[b.id];
  const gap = t != null ? t - prev : null;
  if (gap != null && gap > maxGap) { maxGap = gap; maxPair = b.id; }
  console.log('  ' + b.id.padEnd(3) + (b.scan != null ? ('探测 ' + String(b.scan).padStart(3) + '%')
    : (b.tech != null ? ('解锁 ' + b.tech) : '开局')) + '  →  ' + mmss(t).padStart(6) +
    '   间隔 ' + mmss(gap) + (b.note ? '   [' + b.note + ']' : ''));
  if (t != null) prev = t;
}
console.log('  最大空窗 = ' + maxGap.toFixed(0) + ' s (' + mmss(maxGap) + '),出现在 ' + maxPair +
  '  →  ' + (maxGap <= 180 ? '通过' : '超标!'));
console.log('\n【逐分钟快照】 分 | 材料/上限 速率 | 探 | 仓库 | 探测% | 数据 | 槽 | 采/解');
for (let k = 60; k <= 1020; k += 60) {
  const x = s.snap[k];
  if (!x) continue;
  console.log('  ' + String(k / 60).padStart(4) + ' | ' +
    (x.mat.toFixed(0) + '/' + x.cap.toFixed(0)).padEnd(13) + x.rate.toFixed(1).padStart(6) + ' | ' +
    String(x.probes).padStart(2) + ' | ' + String(x.wh).padStart(3) + '  | ' +
    x.scan.toFixed(1).padStart(5) + ' | ' + x.data.toFixed(1).padStart(6) + ' | ' +
    String(x.slots).padStart(2) + ' | ' + x.drones + '/' + x.decoders);
}
