/* ============================================================
   jsdom-07-v014.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
/* ============================================================
   V0.1.4 自测:用户报的 6 条 + 7 条要求
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
function open(save, alive) {
  return JSDOM.fromURL('http://127.0.0.1:8782/index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse: function (window) {
      if (save) window.localStorage.setItem('vn-01-save', save);
      if (save && alive !== false) window.sessionStorage.setItem('vn-01-alive', '1');
    },
  });
}
function run() {
  return new Promise(function (resolve) {
    server.listen(8782, '127.0.0.1', async function () {
      const errors = [];
      // ---------- 第一段:新游戏 ----------
      let dom = await open();
      dom.window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      let w = dom.window, doc = w.document;
      const peek = (expr) => w.eval(expr);
      const lines = () => [].map.call(doc.querySelectorAll('#log .line'), (e) => e.textContent);
      const rows = () => [].slice.call(doc.querySelectorAll('#tech-list .tech-item'));
      const names = () => rows().map((r) => r.querySelector('.t-name').textContent);
      const hidden = (id) => doc.getElementById(id).classList.contains('hidden');
      const waitFor = async function (cond, ms) {
        const t0 = Date.now();
        while (Date.now() - t0 < (ms || 6000)) { if (cond()) return true; await sleep(120); }
        return cond();
      };
      const type = function (id, s) {
        const inp = doc.getElementById(id);
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      const act = async function (name) {
        const r = rows().find((x) => x.querySelector('.t-name').textContent.indexOf(name) === 0);
        if (!r) throw new Error('找不到:' + name);
        r.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        await sleep(80);
        doc.getElementById('tech-list').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await sleep(150);
      };
      // 按"节点身份"选中再回车:比按名字找行更稳(同名科技 / 建筑各一行)
      const actKey = async function (key) {
        peek('techSelKey = ' + JSON.stringify(key) + '; renderTech()');
        await sleep(100);
        doc.getElementById('tech-list').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await sleep(160);
      };

      await sleep(300);
      doc.getElementById('btn-new').click();
      await sleep(9000);
      console.log('\n【要求 5:例行信息全部折叠,只有剧情用打字机】');
      peek('game.buildings = { warehouse: 5 }; game.material = 2000;');
      for (let i = 0; i < 5; i++) type('cmd-input', '/mine');
      await sleep(300);
      type('cmd-input', '/replicate');
      await sleep(200);
      peek('game.data = 500');
      type('cmd-input', '/research');
      await sleep(250);
      await actKey('tech:click_mine');
      await actKey('tech:click_rep');
      await actKey('tech:reactor');
      peek('game.material = 2000');
      await actKey('building:reactor');   // 建筑 ×1
      await actKey('building:reactor');   // 建筑 ×2
      await sleep(400);
      const foldLines = lines().filter((l) => /×\d+$/.test(l));
      ok('日志里出现折叠行', foldLines.length >= 1, foldLines.join(' | '));
      // 剧情在打字时操作日志会排队,断言要等队列排干
      const buildOk = await waitFor(() => lines().some((l) => l.indexOf('> 建造 反应堆') === 0 && l.indexOf('×2') >= 0), 25000);
      ok('建造折叠:同一行里看到 ×2', buildOk,
        lines().filter((l) => l.indexOf('建造') > 0).join(' | '));
      const unlockOk = await waitFor(() => lines().some((l) => l.indexOf('> 解锁 反应堆') === 0 && l.indexOf('可建造') > 0), 25000);
      ok('解锁只占一行(带效果)', unlockOk,
        lines().filter((l) => l.indexOf('解锁') >= 0).slice(-2).join(' | '));
      // 材料不足:连点 5 次只留一行
      peek('game.material = 0');
      for (let i = 0; i < 5; i++) type('cmd-input', '/replicate');
      await waitFor(() => lines().some((l) => l.indexOf('材料不足') >= 0), 20000);
      await sleep(1500);   // 等打字机把队列排干,看看会不会又冒出第二行
      const poor = lines().filter((l) => l.indexOf('材料不足') >= 0);
      ok('材料不足不刷屏(只有一行,带 ×N)', poor.length === 1 && /×\d+$/.test(poor[0]), poor.join(' | '));

      console.log('\n【bug 4:能量不是硬墙,只警告】');
      peek('game.buildings = { warehouse: 6, reactor: 0, core: 0 }; game.material = 2000; renderTech();');
      await sleep(200);
      await actKey('tech:core');          // 先解科技
      peek('game.material = 2000');
      await actKey('building:core');
      ok('没电也能建核心(不是 hard wall)', peek('game.buildings').core === 1, JSON.stringify(peek('game.buildings')));
      const warned = await waitFor(() => lines().some((l) => l.indexOf('警告：能量不足') >= 0), 6000);
      ok('但会明确警告能量不足', warned, lines().slice(-2).join(' | '));
      await sleep(1500);
      ok('算力槽被功率压到 0(节流真实生效)', peek('slotsTotal()') === 0 && peek('dataRate()') === 0,
        'slots=' + peek('slotsTotal()'));

      console.log('\n【要求 3 + bug 3:模块文本与数值一一对应、写明占槽】');
      peek('game.unlocked = ["click_mine","click_rep","reactor","core","decode","drone","autorep"];');
      peek('game.modules = { decoder: 1 }; game.buildings = { warehouse: 6, reactor: 2, core: 2 }; renderTech();');
      await sleep(300);
      const droneRow = rows().find((r) => r.textContent.indexOf('采集助手') === 0);
      ok('采集助手写明"占 1 个算力槽"', droneRow.textContent.indexOf('算力槽') >= 0, droneRow.textContent.slice(0, 60));
      ok('采集助手数值 = 每台探测器 +0.12 材料/秒', droneRow.textContent.indexOf('0.12') >= 0);
      const droneTechRow = rows().find((r) => r.textContent.indexOf('无人采集') === 0);
      // V0.1.5:用户要自己写这句(只留"可安装「采集助手」"),所以数据表里有文字就以它为准;
      // 数字的唯一来源是模块那一行(上面的断言已经覆盖)
      ok('解锁文本用数据表里写的那一句(不自动追加)',
        droneTechRow.textContent.indexOf('可安装「采集助手」') >= 0,
        droneTechRow.textContent.slice(0, 70));

      console.log('\n【要求 4 + bug 2:科技树右侧就是终端那块读数】');
      ok('科技树里有读数面板', !!doc.getElementById('readout-tech'));
      const rt = doc.getElementById('readout-tech').textContent;
      ok('读数里有材料 / 探测 / 数据', rt.indexOf('材料') >= 0 && rt.indexOf('探测') >= 0 && rt.indexOf('数据') >= 0,
        rt.slice(0, 70));
      ok('读数里的数据量会涨', await (async function () {
        const d0 = peek('game.data');
        await sleep(900);
        return peek('game.data') > d0 && doc.getElementById('readout-tech').textContent.indexOf('数据') >= 0;
      })());
      ok('顶部不再重复显示材料', doc.getElementById('tech-header').textContent.indexOf('材料') < 0,
        doc.getElementById('tech-header').textContent.trim().slice(0, 40));

      console.log('\n【要求 6:探测条有常驻短名】');
      ok('读数里有「探测 xx.x%」这一行', /探测/.test(rt) && /\d+\.\d%/.test(rt), rt.match(/探测[^探]*/)[0]);

      console.log('\n【要求 2:结局类别在解锁前打问号】');
      const catChips = () => [].slice.call(doc.querySelectorAll('#tech-cats .chip'));
      ok('类别里"结局"变成 ???', catChips().some((c) => c.textContent === '???')
        && !catChips().some((c) => c.textContent === '结局'),
        catChips().map((c) => c.textContent).join(','));
      const starRow = rows().find((r) => r.textContent.indexOf('星际航行') === 0);
      ok('星际航行那一行的类别也是 ???', starRow.textContent.indexOf('???') >= 0, starRow.textContent.slice(0, 40));
      peek('game.unlocked.push("starship"); renderTechFilters(); renderTech();');
      await sleep(300);
      ok('解锁之后类别恢复成"结局"', catChips().some((c) => c.textContent === '结局'));

      console.log('\n【bug 5:详情写明前置】');
      const coreRow = rows().find((r) => r.textContent.indexOf('计算核心') === 0 && r.className.indexOf('st-done') < 0);
      (coreRow || rows()[0]).dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await sleep(200);
      ok('详情里有"前置"这一行', doc.getElementById('tech-detail').textContent.indexOf('前置') >= 0,
        doc.getElementById('tech-detail').textContent.slice(0, 60));

      console.log('\n【bug 6:悬停成本会随复制更新】');
      peek('openTech()');
      await sleep(300);
      type('tech-input', '/back');
      await sleep(300);
      peek('game.material = 5000');
      const btn = doc.getElementById('btn-replicate');
      btn.dispatchEvent(new w.MouseEvent('mouseenter', { bubbles: false }));
      await sleep(200);
      const hint1 = doc.getElementById('hint').textContent;
      btn.click();   // 鼠标不离开按钮
      await sleep(300);
      const hint2 = doc.getElementById('hint').textContent;
      ok('悬停提示在复制后立刻更新', hint1 !== hint2 && hint1.indexOf('材料') >= 0 && hint2.indexOf('材料') >= 0,
        hint1.slice(0, 24) + '  →  ' + hint2.slice(0, 24));

      console.log('\n【算力槽不够时:模块按顺序上线,可停用来腾槽】');
      peek('game.buildings = { warehouse: 6, reactor: 3, core: 1 }; game.modules = { decoder: 2, drone: 2 }; game.off = {};');
      await sleep(200);
      // 分配顺序 = 模块表顺序:采集助手 → 解析器 → 复制助手
      ok('只有 1 槽 → 采集助手先跑,解析器空转', peek("slotsFor('drone')") === 1 && peek("slotsFor('decoder')") === 0,
        'decoder=' + peek("slotsFor('decoder')") + ' drone=' + peek("slotsFor('drone')"));
      ok('数据速率按"实际跑起来的解析器数"算(现在是 0)', peek('dataRate()') === 0, String(peek('dataRate()')));
      peek('toggleModule("drone")');   // 停用采集助手 → 解析器顶上
      await sleep(200);
      ok('停用采集助手后,解析器顶上来', peek("slotsFor('decoder')") === 1 && peek("slotsFor('drone')") === 0,
        'decoder=' + peek("slotsFor('decoder')"));
      ok('数据速率跟着变成 0.3', Math.abs(peek('dataRate()') - 0.3) < 1e-9, String(peek('dataRate()')));
      peek('toggleModule("drone")');
      await sleep(100);
      peek('writeSave(snapshot())');

      console.log('\n【bug 1:大退重进后封面成就页不为空】');
      const saved = w.localStorage.getItem('vn-01-save');
      dom.window.close();
      dom = await open(saved, false);   // 模拟"关掉浏览器再打开":不带 sessionStorage 存活标记
      w = dom.window; doc = w.document;
      await sleep(1200);
      doc.getElementById('btn-achievements').click();
      await sleep(300);
      const achText = doc.getElementById('ach-list').textContent;
      const count = doc.getElementById('ach-count').textContent;
      ok('封面成就页有内容(不再需要先读档)', achText.indexOf('还没有获得任何成就') < 0, achText.slice(0, 50));
      ok('成就计数与存档一致', count.indexOf('已解锁 ') === 0 && count.indexOf(' / 0') < 0, count);
      ok('没自动进游戏(停在封面 / 成就页)', hidden('screen') && hidden('tech'));
      await sleep(200);
      console.log('\n【文本:中文标点已全角】');
      const badPunct = (function () {
        const strs = [];
        const walk = function (v) {
          if (typeof v === 'string') strs.push(v);
          else if (v && typeof v === 'object') for (const k in v) walk(v[k]);
        };
        walk(JSON.parse(peek('JSON.stringify(D)')));
        return strs.filter((s) => /[\u4e00-\u9fff][,:.](?=[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])|[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef][,:.](?=[\u4e00-\u9fff])/.test(s));
      })();
      ok('数据表里没有"中文旁边的半角标点"', badPunct.length === 0, badPunct.slice(0, 2).join(' | '));
      ok('控制台无报错', errors.length === 0, JSON.stringify(errors));

      console.log('\n========== 结果:' + pass + ' 通过 / ' + fail + ' 失败 ==========');
      dom.window.close(); server.close(); resolve(fail);
    });
  });
}
run().then((f) => process.exit(f ? 1 : 0));
