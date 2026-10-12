/* ============================================================
   V0.2.0 自测:研究轮落地的三件事(见 docs/research.md 第 27~28 节)
   1) 科技改成"立项 → 研究一段时间 → 完成",研究期间不能开新项目
   2) 科技线与探测线咬合:一部分科技要探测进度先到某个百分比(扫描闸门)
   3) 在科技树里也能知道"终端有新消息",而且不抢操作提示那一行
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
    server.listen(8785, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8785/index.html', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      });
      dom.window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      const w = dom.window, doc = w.document;
      const peek = (expr) => w.eval(expr);
      const rows = () => [].slice.call(doc.querySelectorAll('#tech-list .tech-item'));
      const rowByName = (name) => rows().find((r) => r.querySelector('.t-name').textContent.indexOf(name) === 0);
      const rowText = (name) => { const r = rowByName(name); return r ? r.textContent : '(找不到)'; };
      const hidden = (id) => doc.getElementById(id).classList.contains('hidden');
      const lines = () => [].map.call(doc.querySelectorAll('#log .line'), (e) => e.textContent);
      const hint = () => doc.getElementById('tech-hint').textContent;
      const selectRow = function (name) {
        const r = rowByName(name);
        if (!r) throw new Error('找不到节点:' + name);
        r.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      };
      const enter = () => doc.getElementById('tech-list')
        .dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const type = function (id, s) {
        const inp = doc.getElementById(id);
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      const finish = async function () {   // 把研究拨到过去并立刻结算(不真等 20~85 秒)
        peek('if (game.research) { game.research.startSec = game.timeSec - 9999; advanceResearch(); }');
        await sleep(150);
      };

      await sleep(300);
      doc.getElementById('btn-new').click();
      await sleep(9000);   // 等启动序列打完

      console.log('\n【A. 立项:付钱、进入"研究中"】');
      peek('game.material = 190');
      type('cmd-input', '/research');
      await sleep(250);
      selectRow('简单采集');
      await sleep(120);
      ok('按钮文案是「[ 立项研究 ]」', doc.querySelector('#tech-detail .unlock-btn').textContent.indexOf('立项研究') >= 0,
        doc.querySelector('#tech-detail .unlock-btn').textContent);
      enter();
      await sleep(250);
      // 用户报过:立项后日志与提示都写成"研究 0 秒" —— 根因是 viewNodes() 没把 research 带进视图节点
      ok('立项日志里的秒数是真实值(不是 0)',
        lines().some((l) => l === '> 立项 简单采集 —— 研究 ' + peek('techOf("click_mine").research') + ' 秒'),
        lines().filter((l) => l.indexOf('立项') >= 0).slice(-1).join(' | '));
      ok('提示行里的秒数也是真实值',
        hint().indexOf('研究 ' + peek('techOf("click_mine").research') + ' 秒') >= 0, hint());
      ok('视图节点带着 research 字段', peek('(function(){var n=viewNodes().find(function(x){return x.id==="click_mine";});return typeof n.research;})()') === 'number',
        peek('(function(){var n=viewNodes().find(function(x){return x.id==="click_mine";});return String(n.research);})()'));
      ok('立项后 game.research 指向这一项', peek('game.research && game.research.id') === 'click_mine',
        String(peek('game.research && game.research.id')));
      ok('此刻还没解锁(要等研究完)', peek('game.unlocked').length === 0, JSON.stringify(peek('game.unlocked')));
      ok('材料已经扣掉', peek('game.material') < 155 && peek('game.material') > 120, String(Math.round(peek('game.material'))));
      ok('列表那一行显示「研究中 N%」', rowText('简单采集').indexOf('研究中') >= 0, rowText('简单采集').trim().slice(0, 40));
      ok('右栏读数出现「研究 简单采集 N%」一行',
        doc.getElementById('readout-tech').textContent.indexOf('研究简单采集') >= 0
        && doc.getElementById('readout-tech').textContent.indexOf('剩') >= 0,
        doc.getElementById('readout-tech').textContent.replace(/\s+/g, ' ').slice(0, 60));

      console.log('\n【B. 一次只研究一项】');
      selectRow('批量复制');
      await sleep(120);
      const researchOnce = peek('game.research.id');
      peek('game.material = 9999; game.data = 9999');   // 钱管够,看它是不是还拦
      enter();
      await sleep(250);
      ok('研究期间开不了第二项', peek('game.research.id') === researchOnce, String(peek('game.research.id')));
      ok('并给出"还在研究中"的提示', hint().indexOf('研究中') >= 0, hint());

      console.log('\n【C. 研究完成 → 解锁 + 日志】');
      await finish();
      ok('研究完成后解锁', peek('game.unlocked').join(',') === 'click_mine', peek('game.unlocked').join(','));
      ok('game.research 清空', peek('game.research') === null, String(peek('game.research')));
      ok('科技计数 1 / 14', doc.getElementById('tech-count').textContent.indexOf('1 / 14') >= 0,
        doc.getElementById('tech-count').textContent);
      const doneLine = await (async function () {
        for (let i = 0; i < 40; i++) { if (lines().some((l) => l.indexOf('> 研究完成 简单采集') === 0)) return true; await sleep(150); }
        return false;
      })();
      ok('终端里有「> 研究完成 …」一行', doneLine, lines().filter((l) => l.indexOf('研究') >= 0).slice(-3).join(' | '));
      ok('解锁后出现 [ /mine ] 按钮', !!doc.getElementById('btn-mine'));

      console.log('\n【D. 扫描闸门:探测不够的科技是"锁定"】');
      // 先把「无人采集」的前置链解开(信号解析 —— 否则拦下它的是前置,不是扫描门槛)
      peek('game.unlocked = ["click_mine","click_rep","reactor","core","decode"];' +
        'game.scan = 0; game.data = 9999; game.buildings = {}; game.research = null; renderTech();');
      await sleep(200);
      selectRow('无人采集');
      await sleep(150);
      ok('探测 0% 时「无人采集」显示锁定', rowByName('无人采集').className.indexOf('st-locked') >= 0,
        rowByName('无人采集').className);
      ok('详情里写明探测门槛', doc.getElementById('tech-detail').textContent.indexOf('探测进度 2%') >= 0,
        '[' + doc.getElementById('tech-detail').textContent.replace(/\s+/g, ' ') + ']');
      enter();
      await sleep(200);
      ok('被拦下并说明是探测不够', hint().indexOf('探测进度不够') >= 0, hint());
      peek('game.scan = 30; renderTech();');
      await sleep(200);
      ok('探测过关后它变成可解锁', rowByName('无人采集').className.indexOf('st-ready') >= 0,
        rowByName('无人采集').className);

      console.log('\n【E. 研究进行中探测提速 ×2】');
      peek('game.unlocked = ["click_mine"]; game.probes = 30; game.scan = 20; game.research = null;' +
        'game.buildings = { warehouse: 6 }; renderTech();');
      await sleep(900);
      const rateIdle = peek('game.scan') - 20;
      peek('game.research = { id: "click_rep", startSec: game.timeSec }; game.scan = 20;');
      await sleep(900);
      const rateBusy = peek('game.scan') - 20;
      ok('研究进行中探测明显更快(≈ ×2)', rateBusy > rateIdle * 1.6,
        rateIdle.toFixed(3) + ' → ' + rateBusy.toFixed(3));

      console.log('\n【F. 科技树里的「终端有新消息」】');
      peek('game.research = null; clearStoryPending(); updateTechPending();');
      await sleep(200);
      ok('没有快讯时不显示', hidden('tech-pending'));
      peek('markStoryPending(); updateTechPending();');
      await sleep(200);
      ok('有快讯时出现那一行', !hidden('tech-pending')
        && doc.getElementById('tech-pending').textContent.indexOf('终端有新消息') >= 0,
        doc.getElementById('tech-pending').textContent);
      ok('它是单独一行,不抢操作提示', doc.getElementById('tech-hint').textContent !== doc.getElementById('tech-pending').textContent);
      peek('closeTech();');
      await sleep(200);
      ok('回到终端后自动清掉', hidden('tech-pending') && peek('storyPendingSince') === null,
        String(peek('storyPendingSince')));

      console.log('\n【G. 存档:研究项目与扫描门槛都要能恢复】');
      peek('openTech();');
      await sleep(150);
      peek('game.research = { id: "click_rep", startSec: game.timeSec - 5 }; writeSave(snapshot());');
      const saved = JSON.parse(w.localStorage.getItem('vn-01-save'));
      ok('存档里带了 research 字段', !!saved.research && saved.research.id === 'click_rep',
        JSON.stringify(saved.research));
      peek('game.research = null; applySave(JSON.parse(localStorage.getItem("vn-01-save")));');
      await sleep(200);
      ok('读档后研究进度接着走', peek('game.research && game.research.id') === 'click_rep',
        String(peek('game.research && game.research.id')));
      ok('研究进度按游戏内时间算(=5 秒)', Math.abs(peek('researchElapsed()') - 5) < 2.5,
        String(Math.round(peek('researchElapsed()'))));
      // 老存档(没有 research 字段)要能读
      peek('applySave({ v: "V0.1.5", material: 100, probes: 3, unlocked: ["click_mine"] });');
      await sleep(200);
      ok('老存档没有 research 字段也能读', peek('game.research') === null, String(peek('game.research')));
      ok('老存档仍然不报错、材料读得到', peek('game.material') >= 100, String(Math.round(peek('game.material'))));

      console.log('\n【H. V0.2.0 的数值口径(科技表 / 探测参数)】');
      // 这几项是"科技线与探测线同时收尾"的前提,写死在这里防以后被悄悄改回去;
      // 和 tools/economy-sim.js 的一致性由 tools/check-parity.js 保证(72 项)
      ok('科技的研究秒数 = 20 + 5n', peek('D.techs.every(function(t,i){return t.research === 20 + 5*i;})'));
      ok('9 项科技带探测门槛、数值是 2/8/14/22/32/45/58/68/75',
        peek('JSON.stringify(D.techs.filter(function(t){return t.scanReq != null;}).map(function(t){return t.scanReq;}))')
          === '[2,8,14,22,32,45,58,68,75]',
        peek('JSON.stringify(D.techs.filter(function(t){return t.scanReq != null;}).map(function(t){return t.scanReq;}))'));
      ok('探测参数 = scanK 0.0065 / scanFalloff 140 / scanResearchMul 2',
        peek('D.numbers.scanK') === 0.0065 && peek('D.numbers.scanFalloff') === 140
        && peek('D.numbers.scanResearchMul') === 2);
      ok('v 值就是 game-data 里的 V0.2.0', String(peek('D.version')) === 'V0.2.0', String(peek('D.version')));

      ok('控制台无报错', errors.length === 0, JSON.stringify(errors));
      console.log('\n========== 结果:' + pass + ' 通过 / ' + fail + ' 失败 ==========');
      dom.window.close(); server.close(); resolve(fail);
    });
  });
}
run().then((f) => process.exit(f ? 1 : 0));
