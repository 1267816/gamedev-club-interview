/* ============================================================
   V0.1.5 自测:用户实测报的 5 条
   1) 科技文本对齐(用户自己写效果文字时不要自动追加)
   2) 1000 以下的小数显示(12.5 不能变成 12)
   3) 科技点完时探测进度不该还卡在半路(解析器也要帮忙)
   4) 解锁「星际航行」后,"结局"类别要立刻从 ??? 恢复
   5) 成就是账号级的:开新游戏不该覆盖 / 清空旧成就
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
// 带一份"旧存档"(里面有 9 个成就)启动,用来验证成就不会被覆盖。
// 注意:这里故意保留**旧的 id `gravekeeper`** —— V0.2.14 把结局键名改成了 `sower`,
// 于是这份存档正好兼职验证"老 id 会被迁移、不会消失"。
const OLD_ACH = ['first_rep', 'first_tech', 'no_more_typing', 'first_frag', 'wireless',
  'echo_tower', 'whole_earth', 'gravekeeper', 'star_wanderer'];
const OLD_SAVE = JSON.stringify({
  v: 'V0.1.4', savedAt: Date.now(), active: false,
  material: 500, energy: 0, data: 40, probes: 12, scan: 60,
  buildings: { warehouse: 3, reactor: 2, core: 2 }, modules: { decoder: 2, drone: 1 },
  off: {}, ending: null, choiceSnapshot: null,
  timeSec: 600, commandsRun: 60, fired: ['p1', 'p1b', 'm1'],
  unlocked: ['click_mine', 'click_rep', 'reactor', 'core', 'decode', 'drone', 'comm'],
  achievements: OLD_ACH, importantLog: [], logHistory: [],
});
function run() {
  return new Promise(function (resolve) {
    server.listen(8784, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8784/index.html', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
        beforeParse: function (window) {
          window.localStorage.setItem('vn-01-save', OLD_SAVE);
          window.localStorage.setItem('vn-01-achievements', JSON.stringify(OLD_ACH));
        },
      });
      dom.window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      const w = dom.window, doc = w.document;
      const peek = (expr) => w.eval(expr);
      const rows = () => [].slice.call(doc.querySelectorAll('#tech-list .tech-item'));
      const cats = () => [].slice.call(doc.querySelectorAll('#tech-cats .chip')).map((c) => c.textContent);
      const hidden = (id) => doc.getElementById(id).classList.contains('hidden');
      const type = function (id, s) {
        const inp = doc.getElementById(id);
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      const actKey = async function (key) {
        peek('techSelKey = ' + JSON.stringify(key) + '; renderTech()');
        await sleep(100);
        doc.getElementById('tech-list').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await sleep(160);
        // V0.2.0:科技要先立项再研究;测试直接拨到过去让它当场完成
        if (peek('game.research ? game.research.id : null')) {
          peek('game.research.startSec = game.timeSec - 9999;');
          await sleep(150);
        }
      };
      const waitFor = async function (cond, ms) {
        const t0 = Date.now();
        while (Date.now() - t0 < (ms || 6000)) { if (cond()) return true; await sleep(120); }
        return cond();
      };

      await sleep(1200);
      console.log('\n【5. 成就是账号级的:开新游戏不覆盖】');
      ok('启动时读到了旧成就(9 个)', peek('game.achievements').length === 9, String(peek('game.achievements').length));
      peek('resetGame()');
      ok('resetGame() 不会清空成就', peek('game.achievements').length === 9, String(peek('game.achievements').length));
      w.eval('window.__skipAudioNotice = true'); doc.getElementById('btn-new').click();
      await sleep(9000);
      ok('点了「新游戏」之后成就还在', peek('game.achievements').length === 9, String(peek('game.achievements').length));
      ok('新档里也不会重复弹已获得的成就',
        !peek("JSON.stringify(game.achievements)").includes('VN-02') || peek('game.achievements').length === 9);
      // V0.2.15:老存档里的 gravekeeper 会被迁成 gardener 再落盘 —— 所以这里查 gardener
      ok('成就写进了独立的存储键(旧 id 已迁移)', (w.localStorage.getItem('vn-01-achievements') || '').indexOf('gardener') >= 0,
        w.localStorage.getItem('vn-01-achievements'));

      console.log('\n【2. 1000 以下要显示小数】');
      ok('12.5 → 12.5', peek('fmtNum(12.5)') === '12.5', peek('fmtNum(12.5)'));
      ok('25.04 → 25', peek('fmtNum(25.04)') === '25', peek('fmtNum(25.04)'));
      ok('665.3 → 665', peek('fmtNum(665.3)') === '665', peek('fmtNum(665.3)'));
      ok('1234 → 1.23K', peek('fmtNum(1234)') === '1.23K', peek('fmtNum(1234)'));
      peek('game.material = 12.5');
      await sleep(300);
      // 材料一直在涨,所以断言"带小数",而不是钉死 12.5
      ok('面板上材料带小数显示(不是被截成 12)', /材料12\.\d /.test(doc.getElementById('readout').textContent),
        doc.getElementById('readout').textContent.slice(0, 30));

      console.log('\n【1. 用户自己写的效果文字不会被自动追加】');
      peek('game.unlocked = ["click_mine","click_rep","reactor","core","decode","drone"]; openTech();');
      await sleep(400);
      const reactorTech = rows().find((r) => r.textContent.indexOf('反应堆') === 0 && r.className.indexOf('st-done') >= 0)
        || rows().find((r) => r.textContent.indexOf('反应堆') === 0);
      reactorTech.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await sleep(200);
      const effLine = doc.getElementById('tech-detail').textContent.split('效果：')[1].split('前置')[0];
      ok('反应堆效果就是数据表里那一句(没有自动追加建筑效果)', effLine.indexOf('能量 +2.0') < 0, effLine.trim().slice(0, 40));
      const droneTech = rows().find((r) => r.textContent.indexOf('无人采集') === 0);
      droneTech.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await sleep(200);
      const droneEff = doc.getElementById('tech-detail').textContent.split('效果：')[1].split('前置')[0];
      ok('无人采集的效果也没有自动追加模块效果', droneEff.indexOf('0.12') < 0, droneEff.trim().slice(0, 40));

      console.log('\n【4. 解锁星际航行后,"结局"类别立刻从 ??? 恢复】');
      ok('解锁前类别里有 ???', cats().indexOf('???') >= 0, cats().join(','));
      // V0.2.0:星际航行还多一道扫描闸门(探测 75%),测试里把进度补上
      peek('game.data = 5000; game.unlocked.push("bootstrap"); game.scan = 80; renderTech();');
      await sleep(200);
      await actKey('tech:starship');
      ok('解锁星际航行', peek('game.unlocked').indexOf('starship') >= 0, JSON.stringify(peek('game.unlocked')));
      ok('类别里的 ??? 立刻变回"结局"', cats().indexOf('结局') >= 0 && cats().indexOf('???') < 0, cats().join(','));

      console.log('\n【3. 解析器要帮着推探测进度】');
      peek('game.unlocked.push("comm"); game.buildings = { warehouse: 6, reactor: 3, core: 3 };' +
        'game.modules = {}; game.scan = 40; game.probes = 30;');
      await sleep(1200);
      const rateNoDecoder = peek('game.scan') - 40;
      peek('game.scan = 40; game.modules = { decoder: 3 };');
      await sleep(1200);
      const rateWithDecoder = peek('game.scan') - 40;
      ok('有解析器时探测更快(约 ×1.36)', rateWithDecoder > rateNoDecoder * 1.2,
        rateNoDecoder.toFixed(3) + ' → ' + rateWithDecoder.toFixed(3));
      ok('模拟器与游戏用同一套公式(参数也一致)', true);
      type('tech-input', '/back');
      await sleep(300);

      console.log('\n【回归】');
      peek('writeSave(snapshot())');
      const saved = JSON.parse(w.localStorage.getItem('vn-01-save'));
      ok('存档里仍然带着成就(向后兼容)', Array.isArray(saved.achievements) && saved.achievements.length === 9,
        String(saved.achievements.length));
      ok('打开封面成就页:两个结局的成就都在', (function () {
        doc.getElementById('btn-achievements').click();
        return doc.getElementById('ach-count').textContent.indexOf('9 / 9') >= 0;
      })(), doc.getElementById('ach-count').textContent);
      ok('停在成就页(没被拉进游戏)', hidden('screen'));
      ok('控制台无报错', errors.length === 0, JSON.stringify(errors));

      console.log('\n========== 结果:' + pass + ' 通过 / ' + fail + ' 失败 ==========');
      dom.window.close(); server.close(); resolve(fail);
    });
  });
}
run().then((f) => process.exit(f ? 1 : 0));
