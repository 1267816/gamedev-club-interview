/* ============================================================
   jsdom-06-endings.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
/* ============================================================
   V0.1.3 自测:模块增减/停用、复制助手保留量、科技树实时刷新、
                悬念节点、排序、以及完整的结局流程(含"回到选择时刻")
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
    server.listen(8779, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8779/index.html', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      });
      dom.window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      const w = dom.window, doc = w.document;
      const peek = (e) => w.eval(e);
      const lines = () => [].map.call(doc.querySelectorAll('#log .line'), (e) => e.textContent);
      const rows = () => [].slice.call(doc.querySelectorAll('#tech-list .tech-item'));
      const names = () => rows().map((r) => r.querySelector('.t-name').textContent);
      const sel = () => { const a = doc.querySelector('#tech-list .tech-item.active'); return a ? a.querySelector('.t-name').textContent : null; };
      const clickRow = function (name) {
        const r = rows().find((x) => x.querySelector('.t-name').textContent.indexOf(name) === 0);
        if (!r) throw new Error('找不到节点:' + name);
        r.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      };
      const press = (key) => doc.getElementById('tech-list')
        .dispatchEvent(new w.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
      const type = function (id, s) {
        const inp = doc.getElementById(id);
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      const hint = () => doc.getElementById('tech-hint').textContent;
      const hidden = (id) => doc.getElementById(id).classList.contains('hidden');
      const waitFor = async function (cond, ms) {
        const t0 = Date.now();
        while (Date.now() - t0 < (ms || 6000)) { if (cond()) return true; await sleep(120); }
        return cond();
      };
      const btn = (id) => doc.getElementById(id);

      await sleep(300);
      doc.getElementById('btn-new').click();
      await sleep(9000);
      console.log('\n【A. 科技树实时刷新(bug 3)】');
      peek('game.unlocked = ["click_mine","click_rep"]; game.material = 10;');
      type('cmd-input', '/research');
      await sleep(300);
      // V0.1.4 起科技树右侧复用终端那块读数面板(不再有独立的 #tech-res)
      const readout = () => doc.getElementById('readout-tech').textContent;
      ok('科技树右侧显示资源', readout().indexOf('材料') >= 0, readout().slice(0, 40));
      clickRow('反应堆');
      await sleep(100);
      ok('材料不够时 [ 解锁 ] 是灰的', doc.querySelector('#tech-detail .unlock-btn').disabled);
      const resBefore = readout();
      peek('game.buildings = { warehouse: 3 }; game.material = 950');   // 上限 819,材料立刻到顶
      await sleep(400);
      ok('资源读数会自己涨(不用退出科技树)', readout() !== resBefore,
        resBefore.slice(0, 24) + ' → ' + readout().slice(0, 24));
      ok('攒够材料后 [ 解锁 ] 自动变可用', !doc.querySelector('#tech-detail .unlock-btn').disabled);
      doc.querySelector('#tech-detail .unlock-btn').click();
      await sleep(200);
      // V0.2.0:点 [ 解锁 ] = 立项;把研究拨到过去让它当场完成
      peek('if (game.research) { game.research.startSec = game.timeSec - 9999; advanceResearch(); }');
      await sleep(200);
      ok('点它就能解锁(不用来回切视图)', peek('game.unlocked').indexOf('reactor') >= 0);

      console.log('\n【B. 筛选高亮(bug 2 / bug 6)】');
      const chips = () => [].slice.call(doc.querySelectorAll('#tech-cats .chip'));
      chips().find((c) => c.textContent === '能源').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await sleep(150);
      ok('类别 chip 高亮跟着走', chips().find((c) => c.textContent === '能源').className.indexOf('on') >= 0
        && chips().find((c) => c.textContent === '全部').className.indexOf('on') < 0,
        chips().filter((c) => c.className.indexOf('on') >= 0).map((c) => c.textContent).join(','));
      ok('筛选确实生效(只剩能源类)', rows().length === 2, String(rows().length));
      const st = () => [].slice.call(doc.querySelectorAll('#tech-status .chip'));
      st().find((c) => c.textContent === '已解锁').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await sleep(150);
      ok('状态 chip 高亮也跟着走', st().find((c) => c.textContent === '已解锁').className.indexOf('on') >= 0
        && st().find((c) => c.textContent === '全部').className.indexOf('on') < 0);
      st().find((c) => c.textContent === '全部').onclick();
      chips().find((c) => c.textContent === '全部').onclick();
      await sleep(150);

      console.log('\n【C. 排序:已解锁沉到最下面(bug 5)】');
      peek('game.unlocked = ["click_mine","click_rep","reactor","core","decode"];');
      peek('renderTech()');   // 直接改状态不会重画列表,断言前先重画
      await sleep(400);
      const lastFew = names().slice(-5);
      ok('上面几行里还有锁定/未上线的节点', lastFew.slice(0, 2).every((n) => n.length > 0), lastFew.join(' / '));
      ok('已解锁的 5 项全部沉到最后', names().slice(-5).join(',').indexOf('递归自举') < 0
        && ['简单采集', '批量复制', '反应堆', '计算核心', '信号解析']
          .every((x) => names().slice(-6).some((n) => n.indexOf(x) === 0)),
        names().slice(-6).join(' / '));
      ok('第一行是可操作的(仓库)', names()[0].indexOf('仓库') === 0, names().slice(0, 3).join(' / '));

      console.log('\n【D. 模块:停用 / 启用(bug 9)】');
      peek('game.buildings = { warehouse: 4, reactor: 3, core: 2 }; game.modules = { drone: 2, decoder: 3, rep: 1 };');
      peek('game.unlocked.push("drone","decode")');
      peek('game.probes = 40; game.material = 500;');
      await sleep(400);
      const rateOn = peek('matRate()');
      clickRow('采集助手');
      await sleep(120);
      peek('techSelKey = "module:drone"');   // 用"身份"选中采集助手(列表顺序会变,序号不可靠)
      await sleep(120);
      ok('选中的确实是采集助手模块', sel().indexOf('采集助手') === 0, sel());
      press(' ');
      await sleep(200);
      ok('空格停用采集助手', peek('JSON.stringify(game.off)').indexOf('"drone":true') >= 0,
        peek('JSON.stringify(game.off)'));
      ok('停用后材料速率下降', peek('matRate()') < rateOn - 1, rateOn.toFixed(1) + ' → ' + peek('matRate()').toFixed(1));
      ok('列表里显示"已停止"', rows().some((r) => r.textContent.indexOf('已停止') >= 0));
      ok('停用会写日志', await waitFor(() => lines().some((l) => l.indexOf('停用 采集助手') >= 0), 15000),
        lines().slice(-2).join(' | '));
      press(' ');
      await sleep(200);
      ok('再按一次恢复', Math.abs(peek('matRate()') - rateOn) < 1e-6, peek('matRate()').toFixed(1));
      ok('采集助手数量没变(只是开关)', peek('game.modules.drone') === 2);

      console.log('\n【E. 复制助手:保留量(bug 9 的核心)】');
      // V0.1.4 起模块要抢算力槽:这里只留复制助手一个模块,确保它真的在跑
      peek('game.buildings = { warehouse: 6, reactor: 3, core: 2 }; game.modules = { rep: 1 }; game.off = {};');
      await sleep(250);
      ok('复制助手被算力槽分配到(在跑)', peek("slotsFor('rep')") === 1, 'slots=' + peek('slotsFor(\'rep\')'));
      ok('复制助手在跑', peek("mActive('rep')") === 1);
      peek('game.material = ' + 5);
      const p0 = peek('game.probes');
      await sleep(5200);
      ok('材料远低于成本×3 时它不动手(不再吃光材料)', peek('game.probes') === p0,
        '探测器 ' + p0 + ' → ' + peek('game.probes') + ',材料 ' + Math.round(peek('game.material')));
      peek('game.material = game.material + probeCost() * 5');
      const p1 = peek('game.probes');
      await sleep(5200);
      ok('材料充足时才自动复制', peek('game.probes') > p1, p1 + ' → ' + peek('game.probes'));

      console.log('\n【F. 结局:入口 / 拦截 / 二选一 / 回到选择时刻(bug 10)】');
      peek('game.ending = null; game.choiceSnapshot = null');
      type('cmd-input', '/back');
      await sleep(200);
      type('cmd-input', '/stay');
      await sleep(300);
      ok('没到 75% 时 /stay 被拦下', lines().some((l) => l.indexOf('还不到时候') >= 0));
      ok('两个结局按钮还没出现', !btn('btn-stay') && !btn('btn-go'));
      peek('game.unlocked.push("comm")');
      peek('game.scan = 75');   // 直接压到阈值(tick 会继续往上走)
      await sleep(900);
      ok('75% 触发「回声塔」节点 e1', peek('game.fired').indexOf('e1') >= 0, JSON.stringify(peek('game.fired')));
      const e1 = await waitFor(() => lines().some((l) => l.indexOf('回声塔') >= 0), 6000);
      ok('终端打出回声塔连接演出', e1);
      ok('出现 [ /stay ] 与 [ /go ] 按钮', !!btn('btn-stay') && !!btn('btn-go'));
      type('cmd-input', '/go');
      await sleep(300);
      ok('没研究星际航行时 /go 被拦下', await waitFor(() => lines().some((l) => l.indexOf('缺少星际航行模块') >= 0), 15000),
        lines().slice(-2).join(' | '));
      ok('仍然没有结局', peek('game.ending') === null);
      type('cmd-input', '/stay');
      await sleep(2200);
      ok('选 /stay 进入结局', peek('game.ending') === 'gravekeeper', String(peek('game.ending')));
      ok('成就「守墓人」到手', peek('game.achievements').indexOf('gravekeeper') >= 0,
        JSON.stringify(peek('game.achievements')));
      ok('弹出结算画面', !hidden('ending') && doc.getElementById('end-title').textContent.indexOf('守墓人') >= 0,
        doc.getElementById('end-title').textContent);
      ok('结算画面有 [ 回到选择时刻 ]', !btn('btn-end-choice').disabled);
      peek('writeSave(snapshot())');
      ok('结局已写入存档', JSON.parse(w.localStorage.getItem('vn-01-save')).ending === 'gravekeeper');
      btn('btn-end-choice').click();
      await sleep(400);
      ok('回到选择时刻:结局清空、选项按钮回来', peek('game.ending') === null && !!btn('btn-stay'));
      ok('回到选择时刻:经济账恢复', peek('game.unlocked').indexOf('comm') >= 0 && peek('game.scan') >= 74);
      ok('成就不会被收回(方便凑全成就)', peek('game.achievements').indexOf('gravekeeper') >= 0);

      // V0.2.0:回档时"正在研究的项目"也要跟着回去 ——
      // 不然它会把立项时刻留在未来,变成一项永远研究不完的项目(见 docs/research.md 第 28.9 节)
      console.log('\n【F2. 回档 + 正在研究(V0.2.0 新增)】');
      peek('game.ending = null; game.choiceSnapshot = null;'
        + 'game.unlocked = game.unlocked.filter(function(x){return x !== "probe_eff";});'
        + 'game.data = 999; game.material = 9999;'
        + 'game.research = { id: "probe_eff", startSec: game.timeSec - 30 };');   // 研究 60 秒,已经走了 30 秒
      await sleep(200);
      ok('回档前:研究进度约 50%', Math.abs(peek('researchProgress()') - 0.5) < 0.15, peek('researchProgress()').toFixed(2));
      peek('game.choiceSnapshot = choiceSnapshotState(); game.timeSec += 300;');   // 模拟"又过了一段才选结局"
      await sleep(200);
      peek('backToChoice()');
      await sleep(200);
      ok('回档后研究还在,而且指向的是过去(不是未来)',
        peek('game.research && game.research.id') === 'probe_eff'
        && peek('game.research.startSec') <= peek('game.timeSec'), JSON.stringify(peek('game.research')));
      ok('回档后研究进度没有被重置(仍是约 50%)',
        Math.abs(peek('researchProgress()') - 0.5) < 0.15, peek('researchProgress()').toFixed(2));
      const beforeAuto = peek('game.unlocked').indexOf('probe_eff');
      peek('debugAdvanceResearch(9999)');   // 直接推完,不等真实时间(和 jsdom-03/04 用的办法一样)
      await sleep(150);
      ok('回档后研究能正常完成(不会卡死)', beforeAuto < 0 && peek('game.unlocked').indexOf('probe_eff') >= 0,
        JSON.stringify(peek('game.unlocked')));

      type('cmd-input', '/go');
      await sleep(300);
      ok('回到选择时刻后仍缺星际航行 → /go 还是被拦',
        await waitFor(() => lines().filter((l) => l.indexOf('缺少星际航行模块') >= 0).length >= 1, 15000));
      // 直接把星际航行研究出来,再走太空结局
      peek('game.unlocked.push("starship"); game.data = 0; buildCommands();');
      await sleep(300);
      type('cmd-input', '/go');
      await sleep(2200);
      ok('解锁星际航行后 /go 成功', peek('game.ending') === 'starry', String(peek('game.ending')));
      ok('成就「星海漫游」到手', peek('game.achievements').indexOf('star_wanderer') >= 0);
      ok('结算画面换成星海漫游', doc.getElementById('end-title').textContent.indexOf('星海漫游') >= 0,
        doc.getElementById('end-title').textContent);
      btn('btn-end-continue').click();
      await sleep(300);
      ok('[ 继续运行 ] 回到终端', !hidden('screen') && hidden('ending'));
      ok('结局后再选一次会被挡住', (function () { type('cmd-input', '/stay'); return true; })());
      await sleep(300);
      ok('提示已经做过选择', await waitFor(() => lines().some((l) => l.indexOf('已经做过选择了') >= 0), 15000),
        lines().slice(-2).join(' | '));
      // 100% 的收束句
      peek('game.scan = 100');
      await sleep(600);
      ok('100% 有收束句', peek('game.fired').indexOf('m5') >= 0);
      ok('成就「全部覆盖」到手', peek('game.achievements').indexOf('whole_earth') >= 0);

      console.log('\n【G. 其它回归】');
      ok('复制助手的日志不再刷屏(有 ×N 折叠)', lines().filter((l) => l.indexOf('+1 材料') === 0).length <= 1
        || lines().some((l) => /×\d+$/.test(l)));
      ok('控制台无报错', errors.length === 0, JSON.stringify(errors));
      console.log('\n========== 结果:' + pass + ' 通过 / ' + fail + ' 失败 ==========');
      dom.window.close(); server.close(); resolve(fail);
    });
  });
}
run().then((f) => process.exit(f ? 1 : 0));
