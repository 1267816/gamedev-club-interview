/* ============================================================
   jsdom-05-economy.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
/* ============================================================
   V0.1.2 经济自测:几何成本 / 能量门槛 / 算力槽 / 数据 / 仓库 / 探测进度 / 剧情改挂
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
// 封面版本号要跟 game-data.js 的 version 一致(2026-10-12:不再写死旧版本号)
const GAME_DATA_SRC = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-data.js'), 'utf8');
const GAME_VERSION = (GAME_DATA_SRC.match(/version:\s*"([^"]+)"/) || [])[1] || '';
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
    server.listen(8774, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8774/index.html', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      });
      dom.window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      const w = dom.window, doc = w.document;
      const peek = (expr) => w.eval(expr);
      const lines = () => [].map.call(doc.querySelectorAll('#log .line'), (e) => e.textContent);
      const rows = () => [].slice.call(doc.querySelectorAll('#tech-list .tech-item'));
      const rowNames = () => rows().map((r) => r.querySelector('.t-name').textContent);
      const selName = () => {
        const a = doc.querySelector('#tech-list .tech-item.active');
        return a ? a.querySelector('.t-name').textContent : null;
      };
      const clickRow = function (name) {
        const r = rows().find((x) => x.querySelector('.t-name').textContent.indexOf(name) === 0);
        if (!r) throw new Error('找不到节点:' + name + ' / 现有:' + rowNames().join(','));
        r.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      };
      const act = async function (name) {   // 选中 → 按回车(等价于点 [ 解锁 ]/[ 建造 ])
        clickRow(name);
        await sleep(60);
        doc.getElementById('tech-list').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await sleep(120);
      };
      const hint = () => doc.getElementById('tech-hint').textContent;
      const readout = () => doc.getElementById('readout').textContent;
      const type = function (inputId, s) {
        const inp = doc.getElementById(inputId);
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      const waitFor = async function (cond, ms) {
        const t0 = Date.now();
        while (Date.now() - t0 < (ms || 6000)) { if (cond()) return true; await sleep(120); }
        return cond();
      };
      const waitMat = (n, ms) => waitFor(() => peek('game.material') >= n, ms || 20000);
      const waitData = (n, ms) => waitFor(() => peek('game.data') >= n, ms || 30000);
      const costOfName = function (name, kind) {
        return peek('(function(){var n=viewNodes().find(function(x){return x.name==="' + name
          + '" && x.kind==="' + kind + '"});return n?costOf(n).material:0;})()');
      };
      // 仓库上限是硬墙:想买更贵的东西,必须先扩建仓库(和模拟器里的玩家策略一致)
      const buildWarehouse = async function () {
        const c = peek('costOf(viewNodes().find(function(n){return n.id==="warehouse"})).material');
        await waitMat(c + 0.5, 25000);
        await act('仓库');
      };
      const ensureCap = async function (need) {
        let guard = 0;
        while (peek('matCap()') < need && guard++ < 10) await buildWarehouse();
        return peek('matCap()');
      };
      // 像真人一样:先把仓库上限抬够,再等材料/数据攒够,然后动手
      const doNode = async function (name, kind, coin) {
        if (kind === 'tech') {
          let guard = 0;
          while (peek('(function(){var n=viewNodes().find(function(x){return x.name==="' + name
            + '" && x.kind==="tech"});return n?costOf(n).material:0;})()') > peek('matCap()') && guard++ < 10) {
            await buildWarehouse();
          }
        }
        if (coin === 'data') await waitData(costOfName(name, kind) + 0.5);
        else await waitMat(costOfName(name, kind) + 0.5, 40000);
        await act(name);
      };

      await sleep(300);
      console.log('\n【A. bug 1:复制成本不再固定】');
      ok('封面版本号与 game-data.js 一致(' + GAME_VERSION + ')',
        doc.getElementById('cover-version').textContent.indexOf(GAME_VERSION) >= 0,
        doc.getElementById('cover-version').textContent);
      doc.getElementById('btn-new').click();
      await sleep(9000);
      ok('第 1 台成本 = 10', peek('probeCost()') === 10, String(peek('probeCost()')));
      peek('game.probes = 2');
      ok('第 2 台成本 = 11(×1.10)', Math.abs(peek('probeCost()') - 11) < 1e-9, String(peek('probeCost()')));
      peek('game.probes = 11');
      ok('第 11 台成本 = 25.94', Math.abs(peek('probeCost()') - 10 * Math.pow(1.1, 10)) < 1e-9,
        peek('probeCost()').toFixed(2));
      peek('game.probes = 1');
      peek('game.material = 195');   // 上限 200:材料本身会被上限截断,这里取上限内的值
      type('cmd-input', '/replicate');
      await sleep(200);
      ok('复制扣的是当前成本(195 → 185)', Math.abs(peek('game.material') - 185) < 1.5, String(peek('game.material')));
      ok('复制成本随台数上涨(下一次 > 10)', peek('probeCost()') > 10, peek('probeCost()').toFixed(2));
      ok('材料被仓库上限截住(≤200)', peek('game.material') <= 200.001, String(peek('game.material')));

      console.log('\n【B. 面板:探测进度条 + 材料上限】');
      ok('面板出现探测进度条与百分比', /\d+\.\d%/.test(readout()), readout().slice(0, 60));
      ok('材料显示 当前 / 上限', readout().indexOf('200') >= 0 || readout().indexOf('/') >= 0, readout().slice(0, 40));
      ok('未解锁能量时面板没有能量行', readout().indexOf('能量') < 0);
      ok('未解锁数据时面板没有数据行', readout().indexOf('数据') < 0);

      console.log('\n【C. 科技树里能建造(反应堆 / 计算核心)】');
      type('cmd-input', '/research');
      await sleep(250);
      peek('game.probes = 300');   // 让材料来得快点,好测"仓库 → 更贵的科技"这条链
      await act('简单采集');
      ok('解锁简单采集', peek('game.unlocked').indexOf('click_mine') >= 0);
      ok('仓库出现在列表里(可建造)', rowNames().some((n) => n.indexOf('仓库') === 0), rowNames().join(','));
      await act('批量复制');
      // 反应堆科技要 320 材料,而初始仓库上限只有 200 → 必须先扩建仓库(D5 的"上限决定你能研究多贵的东西")
      await act('反应堆');
      ok('花费超过仓库上限时给出"先扩建仓库"的提示', hint().indexOf('仓库装不下') >= 0, hint());
      ok('仓库行被标了 over 类(列表里一眼能看出)', rows().some((r) => r.className.indexOf('st-') >= 0
        && r.querySelector('.t-cost') && r.querySelector('.t-cost').className.indexOf('over') >= 0));
      await buildWarehouse();
      ok('扩建一次后上限 = 200 × 1.6 = 320', Math.abs(peek('matCap()') - 320) < 1e-6, String(peek('matCap()')));
      const cap2 = await ensureCap(620);
      ok('继续扩建能把上限抬到 620 以上', cap2 >= 620, '上限 ' + cap2);
      await doNode('反应堆', 'tech');
      ok('反应堆科技解锁', peek('game.unlocked').indexOf('reactor') >= 0, JSON.stringify(peek('game.unlocked')));
      await doNode('反应堆', 'building');   // 现在选中的是"反应堆"建筑行
      ok('建造出 1 座反应堆', peek('game.buildings').reactor === 1 || peek('JSON.stringify(game.buildings)').indexOf('"reactor":1') >= 0,
        peek('JSON.stringify(game.buildings)'));
      ok('列表里反应堆显示 ×1', rowNames().some((n) => n.indexOf('反应堆 ×1') === 0), rowNames().join(','));

      // 能量门槛:只有 1 座反应堆时不让造核心
      await doNode('计算核心', 'tech');
      ok('计算核心科技解锁', peek('game.unlocked').indexOf('core') >= 0);
      await doNode('计算核心', 'building');   // V0.1.4:没有硬墙,先建电也行、先建核心也行
      ok('能建造核心', peek('game.buildings').core === 1, hint());
      ok('算力槽 = 1', peek('slotsTotal()') === 1, String(peek('slotsTotal()')));
      await doNode('计算核心', 'building');   // 第 2 个核心:能量不够也不会被拦,只会警告
      ok('能量不足也能硬建(不是 hard wall)', peek('game.buildings').core === 2, String(peek('game.buildings').core));
      const warned = await waitFor(() => lines().some((l) => l.indexOf('能量不足') >= 0), 20000);
      ok('但会明确警告', warned, lines().slice(-2).join(' | '));
      await doNode('反应堆', 'building');   // 第 2 座
      await doNode('反应堆', 'building');   // 第 3 座
      ok('3 座反应堆到位', peek('game.buildings').reactor === 3, String(peek('game.buildings').reactor));
      await doNode('计算核心', 'building');
      ok('第 3 个核心也建起来', peek('game.buildings').core === 3, hint());
      ok('面板出现能量行(净速率)', readout().indexOf('能量') >= 0 && /\/s\)/.test(readout()), readout().match(/能量[^探]*/)[0]);
      ok('面板出现算力行(已用/总)', readout().indexOf('算力') >= 0, readout().match(/算力[^数]*/)[0]);
      ok('算力槽 = 3', peek('slotsTotal()') === 3, String(peek('slotsTotal()')));

      console.log('\n【D. 数据 / 模块 / 槽位取舍】');
      await doNode('信号解析', 'tech');
      ok('信号解析解锁', peek('game.unlocked').indexOf('decode') >= 0);
      await doNode('解析器', 'module');
      ok('装了解析器', peek('game.modules').decoder === 1, peek('JSON.stringify(game.modules)'));
      const d0 = peek('game.data');
      await sleep(1200);
      ok('数据开始积累', peek('game.data') > d0 + 0.1, (peek('game.data') - d0).toFixed(2));
      ok('面板出现数据行', readout().indexOf('数据') >= 0);
      // 槽位 2 个:解析器占 1,再装采集助手刚好占满;第 3 个就该被拦下
      await doNode('无人采集', 'tech', 'data');
      ok('无人采集科技解锁(数据 3)', peek('game.unlocked').indexOf('drone') >= 0, hint());
      await doNode('采集助手', 'module');
      ok('第一个采集助手装上了', peek('game.modules').drone === 1, JSON.stringify(peek('game.modules')));
      // 确定性:1 个核心 = 1 个槽,而且已被占用 → 再装必然被拦
      peek('game.buildings = { warehouse: 6, reactor: 3, core: 1 }; game.off = {};');
      await sleep(250);
      await doNode('采集助手', 'module');
      ok('槽位已满时拒绝安装', hint().indexOf('算力槽已满') >= 0, hint());
      ok('采集助手数量没有增加', peek('game.modules').drone === 1, JSON.stringify(peek('game.modules')));
      await doNode('计算核心', 'building');   // 再建核心 → 多 1 槽(2 槽 = 已用 2)
      await doNode('计算核心', 'building');   // 再建一个 → 3 槽,空出 1 个
      await doNode('采集助手', 'module');
      ok('加核心后能继续装模块', peek('game.modules').drone === 2, JSON.stringify(peek('game.modules')));
      const r1 = peek('matRate()');
      ok('采集助手提高材料速率', r1 > peek('game.probes') * 0.5, r1.toFixed(2));

      console.log('\n【E. 仓库上限】');
      peek('game.material = 199');
      await sleep(600);
      ok('材料被上限挡住(不超过上限)', peek('game.material') <= peek('matCap()') + 0.001,
        String(Math.round(peek('game.material'))) + ' / 上限 ' + Math.round(peek('matCap()')));
      const cap0 = peek('matCap()');
      await act('仓库');
      ok('扩建仓库后上限 ×1.6', Math.abs(peek('matCap()') - cap0 * 1.6) < 1e-6, cap0 + ' → ' + peek('matCap()'));

      console.log('\n【F. 探测进度 + 长距离通信闸门】');
      peek('game.scan = 0; game.probes = 40');
      await sleep(1200);
      const slow = peek('game.scan');
      ok('没通信时探测很慢(×0.2)', slow > 0 && slow < 6, slow.toFixed(2));
      ok('没有通信时提示要研究长距离通信', hint().indexOf('长距离通信') >= 0 || lines().some((l) => l.indexOf('更远的链路') >= 0));
      peek('game.data = 500');
      await doNode('长距离通信', 'tech', 'data');
      ok('长距离通信解锁', peek('game.unlocked').indexOf('comm') >= 0);
      const s0 = peek('game.scan');
      await sleep(1200);
      ok('解锁后探测明显变快(约 ×5)', peek('game.scan') - s0 > slow * 3, (peek('game.scan') - s0).toFixed(2));
      ok('成就「万里为邻」解锁', peek('game.achievements').indexOf('wireless') >= 0);
      // 直接把进度推过各阈值,检查剧情改挂是否生效
      for (const p of [2, 8, 13, 40, 52, 75, 100]) {
        peek('game.scan = ' + p);
        await sleep(350);
        peek('checkStory()');
        await sleep(120);
      }
      const fired = peek('JSON.stringify(game.fired)');
      ok('m1(2%) 触发', fired.indexOf('"m1"') >= 0, fired);
      ok('残片 014(8%) 触发', fired.indexOf('"frag2"') >= 0);
      ok('m2(13%) 触发', fired.indexOf('"m2"') >= 0);
      ok('残片 097(40%) 触发', fired.indexOf('"frag3"') >= 0);
      ok('残片 233(75%) 触发', fired.indexOf('"frag4"') >= 0);
      ok('100% 有收束行', fired.indexOf('"m5"') >= 0);
      ok('成就「第一处痕迹」/「回声塔」/「全部覆盖」', ['first_frag', 'echo_tower', 'whole_earth']
        .every((id) => peek('game.achievements').indexOf(id) >= 0), peek('JSON.stringify(game.achievements)'));

      console.log('\n【G. 存档:新字段持久化】');
      peek('writeSave(snapshot())');
      const saved = JSON.parse(w.localStorage.getItem('vn-01-save'));
      ok('存档带 energy / data / scan / buildings / modules',
        saved.energy != null && saved.data != null && saved.scan != null
        && saved.buildings.core === peek('game.buildings').core
        && saved.modules.decoder === peek('game.modules').decoder
        && saved.buildings.reactor === peek('game.buildings').reactor,
        JSON.stringify([saved.scan, saved.buildings, saved.modules]));
      peek('game.buildings = {}; game.modules = {}; game.scan = 0; game.energy = 0; game.data = 0');
      peek('applySave(readSave())');
      ok('读档恢复建筑 / 模块 / 进度',
        ((peek('JSON.stringify(game.buildings)') || '').indexOf('reactor') >= 0)
        && peek('game.scan') > 0 && peek('game.energy') > 0 && peek('game.data') > 0,
        peek('JSON.stringify(game.buildings)') + ' scan=' + peek('game.scan').toFixed(1));
      peek('applySave({ material: 5, probes: 3, timeSec: 10, fired: [] })');
      ok('旧档(没有新字段)不报错、按默认值来',
        peek('JSON.stringify(game.buildings)') === '{}' && peek('game.scan') === 0, peek('JSON.stringify(game.modules)'));

      console.log('\n【H. 回归】');
      peek('game.material = 100000');
      peek('game.modules = { rep: 1 }');
      peek('game.buildings = { warehouse: 6, reactor: 3, core: 4 }');   // 给复制助手留出算力槽
      const p0 = peek('game.probes');
      await sleep(5000);
      ok('复制助手会自动复制(5 秒内 +1)', peek('game.probes') > p0, p0 + ' → ' + peek('game.probes'));
      const repOk = await waitFor(() => lines().some((l) => l.indexOf('解锁 反应堆') >= 0), 4000);
      ok('科技树操作日志仍在终端', repOk);
      ok('控制台无报错', errors.length === 0, JSON.stringify(errors));

      console.log('\n========== 结果:' + pass + ' 通过 / ' + fail + ' 失败 ==========');
      dom.window.close();
      server.close();
      resolve(fail);
    });
  });
}

run().then((f) => process.exit(f ? 1 : 0));
