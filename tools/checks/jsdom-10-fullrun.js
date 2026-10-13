/* ============================================================
   V0.2.0 全程体检:把一局"快进"着跑完,看剧情节点是否按新时间线正确触发。

   为什么需要它:这一轮把"探测器数量驱动"改成了"探测进度 + 研究时间"驱动,
   时间线整体后移。剧情节点有没有"漏触发 / 重复触发 / 顺序错乱",只有走一遍才知道。

   做法:不真的等 15 分钟,而是把游戏内的计时(每一帧的 DeltaTime)放大 ——
   游戏本身只有一处取时间(顶部 const now = Date.now()),所以整体替换 Date.now 就行,
   tick() 与 src/js/game.js 里所有依赖时间的逻辑都会按"快进后的时间"跑,一行游戏代码不用改。
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer(function (req, res) {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  fs.readFile(path.join(ROOT, rel), function (err, buf) {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream' });
    res.end(buf);
  });
});
let pass = 0, fail = 0;
const ok = function (label, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra ? '  → ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
};
function run() {
  return new Promise(function (resolve) {
    server.listen(8786, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8786/index.html', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
        beforeParse: function (window) {
          // 时间加速:游戏只从 Date.now() 取时间,tick 的 dt 会被 Math.min(dt,5) 截到 5 秒/帧,
          // 所以每 5 秒真实时间就当游戏里过了 5 秒 —— 这里按 60 倍走,1 秒真实时间 ≈ 1 分游戏时间。
          const t0 = Date.now();
          window.Date.now = function () { return t0 + (Date.now() - t0) * 60; };
        },
      });
      dom.window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      const w = dom.window, doc = w.document;
      const peek = (expr) => w.eval(expr);
      const fired = () => peek('game.fired.slice()');
      const lines = () => [].map.call(doc.querySelectorAll('#log .line'), (e) => e.textContent);

      await sleep(300);
      // 剧情触发时记一笔"游戏内时刻",后面用来看先后顺序(比轮询采样准)
      w.eval(`(function(){
        window.__beatLog = [];
        var orig = window.checkStory;
        // checkStory 是函数声明,挂在全局上 —— 包一层记录"这一次新触发了哪些"
        window.checkStory = function(){
          var before = game.fired.length;
          var r = orig.apply(this, arguments);
          if (game.fired.length > before) {
            window.__beatLog.push({ at: Math.round(game.timeSec), ids: game.fired.slice(before) });
          }
          return r;
        };
      })()`);
      w.eval('window.__skipAudioNotice = true'); doc.getElementById('btn-new').click();
      await sleep(9000);   // 启动序列(这里是真实时间,不受加速影响)

      // 自动玩家:这一局的目的是"走完全程看剧情",不是考玩家策略。
      // 按游戏自己的规则能做什么就做什么(工程里最朴素的一条路:挖矿 → 复制 → 研究 → 建造 → 装模块)。
      console.log('\n【启动自动玩家】');
      w.eval(`(function(){
        // 自动玩家:走"和真实玩家一样的路"——采矿 / 复制 / 研究 / 建造 / 装模块。
        // 这一局是用来"走完剧情线 + 验证研究链路"的,不做策略优化,只求能走到底。
        window.__auto = { mined:0, reps:0, techs:0, builds:0, mods:0 };
        function mine(n){ game.material = Math.min(matCap(), game.material + n); }
        function build(id){
          var bag = (id === 'warehouse' || id === 'reactor' || id === 'core') ? game.buildings : game.modules;
          var node = viewNodes().find(function(n){ return n.id === id && n.kind === (bag === game.modules ? 'module' : 'building'); });
          if (!node || node.status === 'locked' || node.status === 'noslot') return false;
          var c = costOf(node).material || 0;
          if (game.material < c) return false;
          game.material -= c; bag[id] = (bag[id]||0) + 1; return true;
        }
        window.__autoTimer = setInterval(function(){
          try {
            if (typeof running === 'undefined' || !running) return;
            var target = D.techs.find(function(t){ return !game.unlocked.includes(t.id) && techAvailable(t); });
            // 1) 立项(一次只研究一项)
            if (target && !game.research
                && (target.cost.material||0) <= game.material && (target.cost.data||0) <= game.data) {
              payCost(target.cost); game.research = { id: target.id, startSec: game.timeSec };
              window.__auto.techs++; return;
            }
            // 2) 目标科技要的材料超过了仓库上限 → 先扩仓库
            if (target && (target.cost.material||0) > matCap()
                && game.material >= costOf({ kind:'building', id:'warehouse', cost:{material: D.buildings[0].cost.material} }).material) {
              if (build('warehouse')) { window.__auto.builds++; return; }
            }
            // 3) 修电力:反应堆跟不上核心就先堆反应堆
            if (game.unlocked.includes('reactor') && (energyGross() - energyNeed()) < bCount('core') * 0.5) {
              if (build('reactor')) { window.__auto.builds++; return; }
            }
            // 4) 算力槽满了就补核心
            if (game.unlocked.includes('core') && slotsUsed() >= slotsTotal() && bCount('core') < 8) {
              if (build('core')) { window.__auto.builds++; return; }
            }
            // 5) 解析器优先(数据是研究的货币),再采集助手、复制助手
            var mods = ['decoder', 'drone', 'rep'];
            for (var i = 0; i < mods.length; i++) {
              var un = D.modules.find(function(m){ return m.id === mods[i]; });
              if (game.unlocked.includes(un.unlockedBy) && slotsUsed() < slotsTotal()) {
                var cnt = game.modules[mods[i]] || 0;
                if (cnt < 4 && game.material >= Math.floor(un.cost.material * Math.pow(un.growth, cnt))) {
                  if (build(mods[i])) { window.__auto.mods++; return; }
                }
              }
            }
            // 6) 钱多了就复制(留一手给研究)
            if (game.material >= probeCost() * 2 && game.material > 120) {
              game.material -= probeCost(); game.probes++; window.__auto.reps++; return;
            }
            // 7) 兜底:采矿
            if (game.material < 500) { mine(2); game.commandsRun++; window.__auto.mined++; }
          } catch (e) { window.__autoErr = String(e && e.message || e); }
        }, 60);
      })()`);
      await sleep(500);
      ok('自动玩家已启动,没有抛错', !peek('window.__autoErr'), String(peek('window.__autoErr')));

      console.log('\n【快进一局:每 500ms 采一次样,直到探测 100% 或超时】');
      const timeline = [];
      let lastFired = fired();
      let lastScan = -1, stall = 0;
      for (let i = 0; i < 240; i++) {          // 最多 120 秒真实时间 ≈ 2 小时游戏时间(足够)
        await sleep(500);
        const f = fired();
        const scan = Number(peek('game.scan'));
        const unlocked = peek('game.unlocked.length');
        if (f.length !== lastFired.length) {
          const fresh = f.filter((x) => lastFired.indexOf(x) < 0);
          timeline.push({ at: Number(peek('game.timeSec')), scan: scan, tech: unlocked, ids: fresh });
          lastFired = f;
        }
        if (scan >= 100 && unlocked >= 14) break;
        if (scan === lastScan) { stall++; } else { stall = 0; }
        lastScan = scan;
        if (stall > 30) { console.log('  (进度停住了,提前结束采样)'); break; }
      }

      console.log('\n【剧情节点时间线】 游戏内时刻 | 探测% | 已解锁科技 | 本次触发');
      for (const e of timeline) {
        console.log('  ' + String(e.at).padStart(6) + 's | ' + e.scan.toFixed(1).padStart(5) + ' | '
          + String(e.tech).padStart(2) + ' | ' + e.ids.join(','));
      }

      const f = fired();
      console.log('\n【体检】');
      ok('没有重复触发(每个 id 只出现一次)', f.length === new Set(f).size, String(f.length) + ' / ' + String(new Set(f).size));
      for (const id of ['p1', 'p1b', 'p2', 'p3', 'p4', 'g1', 'm1', 'frag2', 'm2', 'm2b', 'm2c',
        'm3', 'frag3', 'm4', 'frag4', 'm4b', 'm5', 'e1']) {
        ok('节点 ' + id + ' 触发了', f.indexOf(id) >= 0);
      }
      ok('探测推到 100%', Number(peek('game.scan')) >= 99.9, String(Math.round(peek('game.scan'))));
      ok('14 项科技全部解锁', peek('game.unlocked.length') === 14, String(peek('game.unlocked.length')));
      ok('研究项目已清空(没有卡在研究中)', peek('game.research') === null, String(peek('game.research')));
      ok('每个科技的研究秒数都执行了(累积研究时间 > 600 秒)',
        Number(peek('game.timeSec')) > 600, String(Math.round(peek('game.timeSec'))) + 's');
      ok('没有出现 NaN(材料 / 探测 / 数据)',
        !/NaN/.test(lines().join('')) && isFinite(Number(peek('game.material'))) && isFinite(Number(peek('game.scan'))));
      ok('控制台无报错', errors.length === 0, JSON.stringify(errors).slice(0, 200));

      // 最后一眼:按"触发时刻"看先后。注意 story 表的顺序只是"建议",不是硬顺序 ——
      // 挂"科技解锁"的节点(m3)与挂"探测进度"的节点(m2c / e1)会随玩家策略互换位置,
      // 所以这里只断言**真正的依赖**(after 链 与 硬闸门),不强行要求与表同序。
      const beatLog = peek('window.__beatLog');
      console.log('\n【触发时刻】');
      for (const b of beatLog) console.log('  ' + String(b.at).padStart(6) + 's  ' + b.ids.join(','));
      const order = [];
      for (const b of beatLog) for (const id of b.ids) order.push(id);
      const at = (id) => (beatLog.find((b) => b.ids.indexOf(id) >= 0) || {}).at;
      console.log('\n  实际触发顺序(前 12 个): ' + order.slice(0, 12).join(' → '));
      // 硬依赖:表里写了 after 的,前一个必须先触发
      const afterPairs = peek('D.story.filter(function(n){return n.when && n.when.after;})'
        + '.map(function(n){return [n.when.after, n.id];})');
      for (const [prev, next] of afterPairs) {
        const a = at(prev), b = at(next);
        ok('依赖顺序 ' + prev + ' → ' + next, a != null && b != null && a <= b, String(a) + ' vs ' + String(b));
      }
      ok('p1b(材料 3 的提示)在 p1 之后',
        at('p1b') == null || (at('p1') != null && at('p1') <= at('p1b')),
        String(at('p1')) + ' vs ' + String(at('p1b')));
      // 按探测百分比的"发现顺序"必须单调(这是玩家真正感知到的东西)
      const byScan = ['m1', 'frag2', 'm2', 'm2b', 'm2c', 'frag3', 'm4', 'frag4', 'm4b', 'm5'];
      const scanOrder = [];
      for (const id of order) if (byScan.indexOf(id) >= 0 && scanOrder.indexOf(id) < 0) scanOrder.push(id);
      const expectScan = byScan.filter((id) => scanOrder.indexOf(id) >= 0);
      ok('按探测进度的节点顺序没有错乱(扫描类节点单调递增)', scanOrder.join(',') === expectScan.join(','),
        scanOrder.join(','));

      console.log('\n========== 结果:' + pass + ' 通过 / ' + fail + ' 失败 ==========');
      dom.window.close(); server.close(); resolve(fail);
    });
  });
}
run().then((f) => process.exit(f ? 1 : 0));
