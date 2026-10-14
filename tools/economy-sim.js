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

   V0.2.0 起模拟器里也有"研究要花时间"这回事(见 docs/research.md 第 27~28 节):
     · TECHS 的 research = 立项之后要研究多少秒;scanReq = 需要探测先到百分之几
     · 一次只研究一项。玩家模型默认是**研究期间照常采矿 / 建造 / 买探测器**(真实玩家的样子);
       加 `--research-idle` 可切回"研究期间干等"的旧模型,用来对比两种玩家
     · 研究进行中探测提速 ×P.scanResearchMul(让玩家愿意留在终端看进度)

   改参数:只改下面的 P(数值)与 TECHS(科技)与 BEATS(剧情节点)。
   命令行:node tools/economy-sim.js [scanK] [买探测器的门槛倍数] [--research-idle] [--curve 阈值表]
   验收口径(2026-10-12 V0.2.0 复核:两个模型都通过):
             ① 探测 100% 落在 14:00 前后
             ② 研究走完(最后一项科技解锁)在 14:00~15:00 —— 加上结尾演出,一盘 ≈15~17 分钟
             ③ 相邻剧情节点的间隔 ≤ 180 秒(硬指标,见 docs/research.md 第 19 节;
                现在最长的一段是 2% → 8%(b2),约 2 分 50 秒)
   ============================================================ */

const P = {
  // ---- 材料层 ----
  probeOutput: 0.5,      // 每台探测器 材料/秒
  probeBaseCost: 10,     // 第一台的成本(之后 ×probeGrowth)
  probeGrowth: 1.10,     // 探测器成本增长 r(D3 决策:先取 1.10)

  // ---- 能量层 ----
  reactorCost: 120, reactorGrowth: 1.18,
  reactorRate: 2.0,      // 能量/秒/台
  reactorCap: 25,        // 每台提供的能量上限(V0.2.7:80 → 25 —— 上限太高等于没有约束)

  // ---- 算力层(槽位) ----
  coreCost: 220, coreGrowth: 1.18, coreDrain: 1.5, coreSlots: 1,

  // ---- 模块(各占 1 算力槽) ----
  droneCost: 60,  droneGrowth: 1.12, droneRatePerProbe: 0.12, // 采集助手:每台探测器 +0.12 材料/秒
  decoderCost: 90, decoderGrowth: 1.12, decoderRate: 0.45,    // 解析器 → 数据(V0.2.4 方案 B:0.3 → 0.45)
  repCost: 200, repGrowth: 1.15, repEvery: 4,                 // 复制助手:每 4 秒自动复制
  repReserve: 3,                                             // 只在材料 ≥ 成本×3 时动手
  repReserveCapFrac: 0.8,                                    // V0.2.8:保留量再按"上限×0.8"封顶
                                                             // (成本几何增长 vs 上限加算 → 后期成本×3 顶穿上限)

  // ---- 仓库:材料必须有地方放(D5 灵感 5) ----
  whCost: 120, whGrowth: 1.16, whBaseCap: 200, whAdd: 150,   // V0.2.7:乘算 → 加算(每座 +150,更真实)

  // ---- 星球探测进度(灵感 1) ----
  // 速率系数(命令行第一个参数是数字时才当作 scanK,否则用默认值)
  // V0.2.0:研究改成"需要时间"之后,科技线整体后移,探测跟着放慢,两条线才一起收尾(见 docs/research.md 第 28 节)
  scanK: Number.isFinite(Number(process.argv[2])) ? Number(process.argv[2]) : 0.008,   // V0.2.4 方案 B:0.0065 → 0.008
  scanFalloff: 140,      // 覆盖率衰减:速率 × (1 − 进度/140)(V0.2.0:200 → 140)
  scanNoCommMul: 0.2,    // 未解锁长距离通信:只能扫基地附近
  scanDecoderBonus: 0.12, // 每个在跑的解析器让探测速率 ×(1+0.12)

  // ---- 玩家行为模型 ----
  manualMineSec: 90,     // 前 90 秒按 1 次/秒手动 /mine
  // ---- 研究(V0.2.0:立项之后要研究一段时间才解锁)----
  // 每项科技的研究秒数写在 TECHS 的 research 字段里;一次只研究一项。
  // 研究期间仍然在采矿 / 扩张,所以它不是"空等"。
  scanResearchMul: 2,    // 研究进行中探测提速(让玩家愿意留在终端看进度)

  dt: 0.1, horizon: 1800,
};

// 科技表(顺序 = 玩家模型的购买顺序;货币分工见 D8:点击/硬件用材料,自动化/倍率用数据)
const TECHS = [
  // research = 研究秒数(V0.2.0);scanReq = 需要探测先到这个百分比(V0.2.0 的扫描闸门)
  // V0.2.7:研究时长改成**固定的 12 秒**(原来 10+3n 线性增长 → 后期全在等研究);
  //         探测门槛抬高,让"探测进度"真正成为节奏的把手,而不是形同虚设。
  { id: 'click_mine', cost: { material: 40 },  research: 12 },
  { id: 'click_rep',  cost: { material: 140 }, research: 12 },
  { id: 'reactor',    cost: { material: 320 }, research: 12 },
  { id: 'core',       cost: { material: 620 }, research: 12 },
  { id: 'decode',     cost: { material: 560 }, research: 12 },
  { id: 'drone',      cost: { data: 3 },   research: 12, scanReq: 5 },    // 无人采集
  { id: 'comm',       cost: { data: 5 },   research: 12, scanReq: 15 },   // 长距离通信(解除探测 ×0.2)
  { id: 'autorep',    cost: { data: 9 },   research: 12, scanReq: 25 },   // 自主复制
  { id: 'probe_eff',  cost: { data: 14 },  research: 12, scanReq: 35 },   // 采集优化 ×1.5
  { id: 'core_eff',   cost: { data: 22 },  research: 12, scanReq: 45 },   // 并行调度:槽 ×2、耗能 ×0.8
  { id: 'decode_eff', cost: { data: 32 },  research: 12, scanReq: 55 },   // 语义重构:解析 ×1.6
  { id: 'fusion',     cost: { data: 47 },  research: 12, scanReq: 65 },   // 聚变改良:反应堆 ×1.6
  { id: 'bootstrap',  cost: { data: 72 },  research: 12, scanReq: 72 },   // 递归自举:探测器 ×2
  { id: 'starship',   cost: { data: 102 }, research: 12, scanReq: 75 },   // 星际航行(钉在回声塔那一刻)
];

// 剧情节点:挂在探测进度上;tech 型节点挂在科技解锁上
const BEATS = [
  { id: 'b0', label: '残片 001(第一次复制,现有节点)' },
  { id: 'b1', scan: 2 }, { id: 'b2', scan: 8 },
  { id: 'b3', scan: 13, note: '本地扫完 → 提示需要长距离通信' },
  { id: 'b3b', scan: 20, note: 'V0.2.0 新增:机器侧一句(填 13%→comm 的等待)' },
  { id: 'b3c', scan: 30, note: 'V0.2.0 新增:机器侧一句' },
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
const matCap      = (n) => P.whBaseCap + P.whAdd * n;   // V0.2.7:加算(每座 +whAdd)

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
// 下一项"现在就能立项"的科技:没解锁、且扫描闸门已过(V0.2.0)。
// 过了闸门才轮得到它 —— 这样"探测进度"就成了科技线的真门槛,两条线才咬得住。
const nextTech = (s) => TECHS.find((t) => !s.unlocked[t.id] && (t.scanReq == null || s.scan >= t.scanReq));

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
  const matRate = s.probes * (P.probeOutput * s.probeMul + P.droneRatePerProbe * s.drones) + manual;
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
      const gate = Math.min(c * P.repReserve, cap * P.repReserveCapFrac);   // V0.2.8:封顶
      if (s.material >= Math.max(c, gate)) { s.material -= c; s.probes += 1; }
    }
  }
  const scanMul = s.unlocked.comm ? 1 : P.scanNoCommMul;
  const falloff = Math.max(0.25, 1 - s.scan / P.scanFalloff);
  const decoderBonus = 1 + P.scanDecoderBonus * s.decoders;   // 解析器也在帮忙定位
  const researchBonus = (s.research ? P.scanResearchMul : 1);  // V0.2.0:研究进行中探测提速
  s.scan = Math.min(s.scan + s.probes * P.scanK * decoderBonus * scanMul * falloff * researchBonus * dt, 100);

  return { matRate, gross, need, slots, scale, cap };
}

// 玩家模型:先科技 → 补仓库 → 补能量/核心 → 装模块 → 剩下的钱买探测器
// keepWorkingWhileResearching = true 时,立项之后不会 return,而是接着花钱(更像真实玩家:
// 研究跑着,他还在采矿 / 盖房子)。用 --research-idle 走另一条路来对比两种玩家。
function decide(s, ph) {
  const keepWorking = process.argv.indexOf('--research-idle') < 0;
  // ---- 研究要做完才解锁(V0.2.0)----
  if (s.research) {
    if (s.t - s.research.startSec < s.research.sec) {
      if (!keepWorking) return;   // 旧模型:研究期间干等着(只对比用)
    }
    s.research = null;
  }
  const tech = nextTech(s);
  if (tech && !s.research && aff(s, tech.cost) && s.t > 2) {
    pay(s, tech.cost); s.unlocked[tech.id] = s.t; applyTech(s, tech.id);
    const rsec = tech.research || 0;
    s.research = { id: tech.id, startSec: s.t, sec: rsec };
    s.researchDone = s.researchDone || {};
    s.researchDone[tech.id] = s.t + rsec;
    s.log.push([s.t, 'tech', tech.id]);
    if (!keepWorking) return;   // 旧模型:立项后干等
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
  // 买探测器的门槛:材料要比成本高出一截才动手(留钱给科技)。命令行第 3 个参数可覆盖,
  // 用来模拟"省着买"与"使劲买"两类玩家(V0.2.0 调探测节奏时用的)
  const buyMul = Number.isFinite(Number(process.argv[4])) ? Number(process.argv[4]) : 1.8;
  if (s.material > probeCost(s.probes - 1) * buyMul && s.material >= probeCost(s.probes - 1)) {
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
console.log('\n【科技时间线:立项时刻 → 研究完成时刻】');
console.log('  ' + TECHS.map((t) => t.id + ' ' + mmss(s.unlocked[t.id]) + '→' + mmss(s.researchDone && s.researchDone[t.id])).join('  '));
console.log('  全部研究完成 = ' + mmss(s.researchDone && s.researchDone.starship));
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
