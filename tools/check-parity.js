/* ============================================================
   tools/check-parity.js —— 检查"游戏数值"与"模拟器数值"是否一致

   为什么要这个:docs/research.md 里的节奏结论全部来自 tools/economy-sim.js,
   一旦有人只改了 game-data.js(或只改了模拟器),文档里的数字就悄悄失效了。
   这个脚本把两边的参数逐项比对,不一致就报错退出。

   用法(仓库根目录):node tools/check-parity.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const G = new Function(fs.readFileSync(path.join(ROOT, 'src/js/game-data.js'), 'utf8') + '; return GAME_DATA;')();
const simSrc = fs.readFileSync(path.join(ROOT, 'tools/economy-sim.js'), 'utf8');
const block = simSrc.match(/const P = \{([\s\S]*?)\n\};/)[1];
const sim = {};
for (const m of block.matchAll(/(\w+)\s*:\s*([0-9.]+)/g)) sim[m[1]] = Number(m[2]);
// scanK 在模拟器里是"带默认值的命令行参数",正则抓不到,单独取那行的最后一个数字
sim.scanK = Number((block.match(/scanK:[^\n]*?([0-9.]+)\s*,?\s*\n/) || [])[1]);

const find = (arr, id) => arr.find((x) => x.id === id);
let bad = 0;
const cmp = function (label, a, b) {
  const same = Number(a) === Number(b);
  if (!same) bad++;
  console.log((same ? '  ✓ ' : '  ✗ ') + label.padEnd(36) + ' 游戏=' + a + '  模拟器=' + b);
};

// —— 资源层参数 ——
cmp('probeBaseCost / probeBaseCost', G.numbers.probeBaseCost, sim.probeBaseCost);
cmp('probeGrowth / probeGrowth', G.numbers.probeGrowth, sim.probeGrowth);
cmp('probeOutput / probeOutput', G.numbers.probeOutput, sim.probeOutput);
cmp('reactorRate / reactorRate', G.numbers.reactorRate, sim.reactorRate);
cmp('reactorCap / reactorCap', G.numbers.reactorCap, sim.reactorCap);
cmp('coreDrain / coreDrain', G.numbers.coreDrain, sim.coreDrain);
cmp('slotPerCore / coreSlots', G.numbers.slotPerCore, sim.coreSlots);
cmp('droneRatePerProbe / droneRatePerProbe', G.numbers.droneRatePerProbe, sim.droneRatePerProbe);
cmp('decoderRate / decoderRate', G.numbers.decoderRate, sim.decoderRate);
cmp('repEvery / repEvery', G.numbers.repEvery, sim.repEvery);
cmp('repReserve / repReserve', G.numbers.repReserve, sim.repReserve);
cmp('warehouseCap / whBaseCap', G.numbers.warehouseCap, sim.whBaseCap);
cmp('warehouseMul / whCapMul', G.numbers.warehouseMul, sim.whCapMul);
cmp('scanK / scanK', G.numbers.scanK, sim.scanK);
cmp('scanFalloff / scanFalloff', G.numbers.scanFalloff, sim.scanFalloff);
cmp('scanNoCommMul / scanNoCommMul', G.numbers.scanNoCommMul, sim.scanNoCommMul);
cmp('scanDecoderBonus / scanDecoderBonus', G.numbers.scanDecoderBonus, sim.scanDecoderBonus);
cmp('scanResearchMul / scanResearchMul', G.numbers.scanResearchMul, sim.scanResearchMul);

// —— 建筑 / 模块 ——
cmp('仓库 cost / whCost', find(G.buildings, 'warehouse').cost.material, sim.whCost);
cmp('仓库 growth / whGrowth', find(G.buildings, 'warehouse').growth, sim.whGrowth);
cmp('反应堆 cost / reactorCost', find(G.buildings, 'reactor').cost.material, sim.reactorCost);
cmp('反应堆 growth / reactorGrowth', find(G.buildings, 'reactor').growth, sim.reactorGrowth);
cmp('计算核心 cost / coreCost', find(G.buildings, 'core').cost.material, sim.coreCost);
cmp('计算核心 growth / coreGrowth', find(G.buildings, 'core').growth, sim.coreGrowth);
cmp('采集助手 cost / droneCost', find(G.modules, 'drone').cost.material, sim.droneCost);
cmp('采集助手 growth / droneGrowth', find(G.modules, 'drone').growth, sim.droneGrowth);
cmp('解析器 cost / decoderCost', find(G.modules, 'decoder').cost.material, sim.decoderCost);
cmp('解析器 growth / decoderGrowth', find(G.modules, 'decoder').growth, sim.decoderGrowth);
cmp('复制助手 cost / repCost', find(G.modules, 'rep').cost.material, sim.repCost);
cmp('复制助手 growth / repGrowth', find(G.modules, 'rep').growth, sim.repGrowth);

// —— 科技花费 ——
const techCost = function (id, res) { return (find(G.techs, id).cost[res] || 0); };
const simTechCost = function (id, res) {
  const m = simSrc.match(new RegExp("\\{ id: '" + id + "'[^}]*cost: \\{ " + res + ": ([0-9.]+) \\}"));
  return m ? Number(m[1]) : NaN;
};
for (const id of ['click_mine', 'click_rep', 'reactor', 'core', 'decode', 'drone', 'comm',
  'autorep', 'probe_eff', 'core_eff', 'decode_eff', 'fusion', 'bootstrap', 'starship']) {
  const res = techCost(id, 'material') ? 'material' : 'data';
  cmp('科技 ' + id + '(' + res + ')', techCost(id, res), simTechCost(id, res));
  // V0.2.0:研究秒数 + 扫描门槛也要一一对上(它们是节奏的主要旋钮,更不该两边各写一份)
  // 注意:TECHS 的每一项里还嵌着 cost: { ... } 的 "}",所以先用 id 把该项切出来再匹配
  const simField = function (field) {
    const start = simSrc.indexOf("{ id: '" + id + "'");
    if (start < 0) return NaN;
    const eol = simSrc.indexOf("\n", start);
    const line = simSrc.slice(start, eol < 0 ? simSrc.length : eol);
    const m = line.match(new RegExp(field + ": ([0-9.]+)"));
    return m ? Number(m[1]) : NaN;
  };
  const t = find(G.techs, id);
  cmp('科技 ' + id + ' research', t.research, simField('research'));
  // 没写 scanReq = 0(没有扫描门槛),两边都按 0 比
  cmp('科技 ' + id + ' scanReq', (t.scanReq || 0), (simField('scanReq') || 0));
}

console.log(bad ? '\n✗ 有 ' + bad + ' 项不一致 —— 改完记得同步 tools/economy-sim.js 与文档'
  : '\n✓ 游戏与模拟器参数完全一致');
process.exit(bad ? 1 : 0);
