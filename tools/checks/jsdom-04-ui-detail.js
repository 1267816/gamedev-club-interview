/* ============================================================
   jsdom-04-ui-detail.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
/* ============================================================
   V0.1.1 深度自测:科技树 / 成就 / 闲置提示 / 存档迁移 / 单位缩写 / 回归
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
    server.listen(8772, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8772/index.html', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      });
      dom.window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      const w = dom.window, doc = w.document;
      const peek = (expr) => w.eval(expr);
      const lines = () => [].map.call(doc.querySelectorAll('#log .line'), (e) => e.textContent);
      const lineCount = () => doc.querySelectorAll('#log .line').length;
      const hidden = (id) => doc.getElementById(id).classList.contains('hidden');
      const rows = () => [].slice.call(doc.querySelectorAll('#tech-list .tech-item'));
      const rowNames = () => rows().map((r) => r.querySelector('.t-name') ? r.querySelector('.t-name').textContent : r.textContent);
      const chipsOf = (id) => [].slice.call(doc.querySelectorAll('#' + id + ' .chip'));
      const chip = (id, label) => chipsOf(id).find((c) => c.textContent === label);
      const type = function (inputId, s) {
        const inp = doc.getElementById(inputId);
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      const press = (target, k) => target.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      const clickTechRow = function (name) {
        const r = rows().find((x) => x.textContent.indexOf(name) === 0);
        if (!r) throw new Error('找不到节点:' + name);
        r.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      };
      const selName = () => {
        const a = doc.querySelector('#tech-list .tech-item.active');
        return a ? a.querySelector('.t-name').textContent : null;
      };
      const waitFor = async function (cond, ms) {
        const t0 = Date.now();
        while (Date.now() - t0 < (ms || 6000)) { if (cond()) return true; await sleep(120); }
        return cond();
      };

      await sleep(300);
      console.log('\n【A. 封面与面板】');
      ok('封面版本号 V0.1.2', doc.getElementById('cover-version').textContent.indexOf('V0.1.2') >= 0,
        doc.getElementById('cover-version').textContent);
      ok('封面 5 个按钮', doc.querySelectorAll('.cover-menu button').length === 5,
        [].map.call(doc.querySelectorAll('.cover-menu button'), (b) => b.textContent).join(''));

      doc.getElementById('btn-new').click();
      await sleep(6000);
      ok('侧栏含「科技 0 / 14」', doc.getElementById('readout').textContent.indexOf('0 / 14') >= 0);
      ok('没有 [ /mine ] 按钮(未解锁)', !doc.getElementById('btn-mine'));
      ok('有 [ /research ] 按钮', !!doc.getElementById('btn-research'));
      ok('命令按钮顺序', [].map.call(doc.querySelectorAll('#commands button'), (b) => b.textContent).join(' ')
        === '[ /save ] [ /exit ] [ /research ]',
        [].map.call(doc.querySelectorAll('#commands button'), (b) => b.textContent).join(' '));

      console.log('\n【B. 大数缩写(直接算)】');
      ok('0.5 / 42 / 999', peek("fmtNum(0.5)") === '0.5' && peek("fmtNum(42)") === '42' && peek("fmtNum(999)") === '999',
        [peek("fmtNum(0.5)"), peek("fmtNum(42)"), peek("fmtNum(999)")].join(' '));
      ok('1000 → 1.00K,1234 → 1.23K', peek("fmtNum(1000)") === '1.00K' && peek("fmtNum(1234)") === '1.23K',
        peek("fmtNum(1234)"));
      ok('1e6 / 1.5e9 / 2e12', peek("fmtNum(1e6)") === '1.00M' && peek("fmtNum(1.5e9)") === '1.50B'
        && peek("fmtNum(2e12)") === '2.00T', [peek("fmtNum(1e6)"), peek("fmtNum(1.5e9)"), peek("fmtNum(2e12)")].join(' '));
      ok('1e15 → 1.00Qa(不出现 e+15)', peek("fmtNum(1e15)") === '1.00Qa', peek("fmtNum(1e15)"));
      peek('game.buildings = { warehouse: 10 }');   // 上限够高,材料才放得下
      peek('game.material = 12345');
      await sleep(250);   // 面板是 tick 里渲染的,等一下再断言
      ok('侧栏确实显示缩写', doc.getElementById('readout').textContent.indexOf('12.35K') >= 0,
        doc.getElementById('readout').textContent.slice(0, 40));
      peek('game.buildings = {}');
      peek('game.material = 0');

      console.log('\n【C. 科技树:打开 / 渲染 / 排序】');
      type('cmd-input', '/research');
      await sleep(250);
      ok('整屏切到科技树', !hidden('tech') && hidden('screen'));
      ok('渲染 20 个节点(14 科技 + 3 建筑 + 3 模块)', rows().length === 20, String(rows().length));
      ok('排序:可解锁在最前', rowNames()[0] === '简单采集', rowNames().slice(0, 3).join(' / '));
      ok('排序:未解锁的仓库紧跟在它解锁项后面', rowNames()[1] === '仓库', rowNames().slice(0, 3).join(' / '));
      ok('已经没有"未上线"节点了(星际航行在 V0.1.3 上线,改为锁定)', rows().every((r) => r.className.indexOf('st-wip') < 0),
        rowNames().slice(-2).join(' / '));

      console.log('\n【D. 三筛选器 + 组合】');
      chip('tech-status', '可解锁').onclick();
      await sleep(60);
      ok('状态=可解锁 → 1 项', rows().length === 1 && rowNames()[0] === '简单采集');
      chip('tech-status', '锁定').onclick();
      await sleep(60);
      ok('状态=锁定 → 19 项', rows().length === 19 && rowNames()[0] === '仓库',
        String(rows().length));
      chip('tech-status', '未上线').onclick();
      await sleep(60);
      ok('状态=未上线 → 0 项 + 空提示', rows().length === 1
        && rows()[0].textContent.indexOf('没有符合条件') >= 0, rows()[0].textContent.slice(0, 20));
      chip('tech-cats', '硬件').onclick();
      await sleep(60);
      ok('未上线 + 硬件 → 仍然是 0 项', rows().length === 1 && rows()[0].textContent.indexOf('没有符合条件') >= 0,
        rows()[0].textContent.slice(0, 20));
      chip('tech-cats', '操作').onclick();
      await sleep(60);
      ok('空结果时给出空提示', rows().length === 1
        && rows()[0].textContent.indexOf('没有符合条件的节点') >= 0, rows()[0].textContent.slice(0, 20));
      ok('空结果时详情不报错', doc.getElementById('tech-detail').innerHTML === '');
      chip('tech-status', '全部').onclick();
      chip('tech-cats', '全部').onclick();
      await sleep(60);
      ok('复位 → 20 项', rows().length === 20);
      const search = doc.getElementById('tech-search');
      search.value = '语义';
      search.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(60);
      ok('文本=语义 → 1 项', rows().length === 1 && rowNames()[0] === '语义重构');
      search.value = '数据';
      search.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(60);
      ok('文本=数据 → 命中信号解析 + 解析器', rows().length === 2 && rowNames().indexOf('信号解析') >= 0
        && rowNames().indexOf('解析器') >= 0,
        rowNames().join(' / '));
      search.value = '';
      search.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(60);

      console.log('\n【E. 详情 / 键盘导航】');
      ok('默认选中第一项', selName() === '简单采集');
      ok('详情含花费与效果', doc.getElementById('tech-detail').textContent.indexOf('材料 40') >= 0
        && doc.getElementById('tech-detail').textContent.indexOf('解锁 /mine 的点击按钮') >= 0);
      press(doc.getElementById('tech-list'), 'ArrowDown');
      await sleep(60);
      ok('↓ 移到下一行', selName() === '仓库', selName());
      press(doc.getElementById('tech-list'), 'End');
      await sleep(60);
      ok('End → 最后一项(自然顺序最末:星际航行)', selName() === '星际航行', selName());
      press(doc.getElementById('tech-list'), 'PageUp');
      await sleep(60);
      ok('PageUp 一次退 8 行(19 → 11)', selName() === '长距离通信', selName());
      press(doc.getElementById('tech-list'), 'Home');
      await sleep(60);
      ok('Home → 第一项', selName() === '简单采集');

      console.log('\n【F. 解锁:各种拦截与两条路径】');
      peek('game.material = 10');
      press(doc.getElementById('tech-list'), 'Enter');
      await sleep(80);
      ok('材料不足被拦下', doc.getElementById('tech-hint').textContent.indexOf('资源不足') >= 0,
        doc.getElementById('tech-hint').textContent);
      ok('没扣材料也没解锁', peek('game.material') < 12 && peek('game.unlocked').length === 0);
      clickTechRow('批量复制');
      await sleep(60);
      press(doc.getElementById('tech-list'), 'Enter');
      await sleep(80);
      ok('前置未满足被拦下(提示缺哪个)', doc.getElementById('tech-hint').textContent.indexOf('前置未满足') >= 0
        && doc.getElementById('tech-hint').textContent.indexOf('简单采集') >= 0,
        doc.getElementById('tech-hint').textContent);
      clickTechRow('反应堆');
      await sleep(60);
      press(doc.getElementById('tech-list'), 'Enter');
      await sleep(80);
      ok('还没解锁前置的节点被拦下', doc.getElementById('tech-hint').textContent.indexOf('前置未满足') >= 0,
        doc.getElementById('tech-hint').textContent);

      clickTechRow('星际航行');
      await sleep(60);
      press(doc.getElementById('tech-list'), 'Enter');
      await sleep(80);
      ok('未达前置的星际航行被拦下', doc.getElementById('tech-hint').textContent.indexOf('前置未满足') >= 0,
        doc.getElementById('tech-hint').textContent);
      ok('星际航行的效果还藏着(问号)', doc.querySelector('#tech-detail').textContent.indexOf('效果：???') >= 0,
        doc.querySelector('#tech-detail').textContent.slice(0, 40));

      // 鼠标路径:点行 → 点 [ 解锁 ] 按钮
      peek('game.material = 150');
      clickTechRow('简单采集');
      await sleep(60);
      doc.querySelector('#tech-detail .unlock-btn').click();
      await sleep(200);
      ok('鼠标点 [ 解锁 ] 成功', peek('game.unlocked').join(',') === 'click_mine', peek('game.unlocked').join(','));
      ok('扣了 40 材料', peek('game.material') < 115 && peek('game.material') > 100,
        String(Math.round(peek('game.material'))));
      ok('解锁后出现 [ /mine ]', !!doc.getElementById('btn-mine'));
      ok('解锁按钮变成 [ 已解锁 ] 且禁用', doc.querySelector('#tech-detail .unlock-btn').textContent === '[ 已解锁 ]'
        && doc.querySelector('#tech-detail .unlock-btn').disabled);
      press(doc.getElementById('tech-list'), 'Enter');
      await sleep(80);
      ok('重复解锁给出提示', doc.getElementById('tech-hint').textContent.indexOf('已经解锁') >= 0,
        doc.getElementById('tech-hint').textContent);
      ok('成就 first_tech 已获得', peek('game.achievements').indexOf('first_tech') >= 0);
      const toast = await waitFor(() => lines().some((l) => l.indexOf('你获得了一个成就：我们开始思考') >= 0));
      ok('终端弹出成就提示', toast);

      // 键盘路径:解锁批量复制
      peek('game.material = 150');
      chip('tech-status', '可解锁').onclick();
      await sleep(60);
      ok('批量复制变成可解锁', rowNames().indexOf('批量复制') >= 0, rowNames().join(' / '));
      clickTechRow('批量复制');
      await sleep(60);
      press(doc.getElementById('tech-list'), 'Enter');
      await sleep(200);
      ok('回车解锁成功', peek('game.unlocked').indexOf('click_rep') >= 0);
      ok('出现 [ /replicate ] 按钮', !!doc.getElementById('btn-replicate'));
      ok('成就「不必再打字」', peek('game.achievements').indexOf('no_more_typing') >= 0);
      chip('tech-status', '全部').onclick();
      await sleep(60);

      console.log('\n【G. 科技树里的命令输入行】');
      const ti = doc.getElementById('tech-input');
      ti.value = '/b';
      ti.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(60);
      ok('输入 /b 弹面板且只有 /back', !hidden('tech-palette')
        && doc.querySelectorAll('#tech-palette .palette-item').length === 1
        && doc.querySelector('#tech-palette .palette-item').textContent.indexOf('/back') === 0,
        doc.querySelector('#tech-palette .palette-item') ? doc.querySelector('#tech-palette .palette-item').textContent : '—');
      ti.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      await sleep(60);
      ok('Tab 补全成 /back', ti.value === '/back', ti.value);
      ti.value = '/';
      ti.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(60);
      ok('输入 / 列出全部 8 条命令(含结局的 /stay /go)', doc.querySelectorAll('#tech-palette .palette-item').length === 8,
        String(doc.querySelectorAll('#tech-palette .palette-item').length));
      ti.value = 'xyz';
      ti.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(60);
      ok('无效输入不会被清空(上一次修的 bug)', ti.value === 'xyz', ti.value);
      ti.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const badCmd = await waitFor(() => lines().some((l) => l.indexOf('未知命令：xyz') >= 0), 5000);
      ok('无效命令给出错误行', badCmd, lines().slice(-3).join(' | '));
      ok('仍在科技树里(没被踢出去)', !hidden('tech'));
      type('tech-input', '/back');
      await sleep(200);
      ok('/back 回到终端', !hidden('screen') && hidden('tech'));

      console.log('\n【H. 点击命令按钮(解锁后)】');
      const m0 = peek('game.material');
      doc.getElementById('btn-mine').click();
      await sleep(150);
      ok('[ /mine ] +1', peek('game.material') - m0 > 0.9, (peek('game.material') - m0).toFixed(2));
      peek('game.material = 100');
      const p0 = peek('game.probes');
      doc.getElementById('btn-replicate').click();
      await sleep(150);
      ok('[ /replicate ] 探测器 +1', peek('game.probes') === p0 + 1);
      peek('game.material = 3');
      await sleep(150);
      ok('材料不足时 [ /replicate ] 按钮禁用', doc.getElementById('btn-replicate').disabled);
      ok('关闭按钮对已解锁命令不生效的旧 bug 没回来', !!doc.getElementById('btn-mine'));

      console.log('\n【I. 闲置提示:会提示、不重复、封面不提示】');
      const idleBefore = lines().filter((l) => l.indexOf('指南：') === 0).length;
      peek('lastActionAt = Date.now() - 200000');
      const fired = await waitFor(() => lines().filter((l) => l.indexOf('指南：') === 0).length > idleBefore, 8000);
      ok('3 分钟无操作 → 提示一句', fired);
      const idleAfter = lines().filter((l) => l.indexOf('指南：') === 0).length;
      peek('lastActionAt = Date.now() - 200000');
      await sleep(1200);
      ok('同一条不会重复刷屏', lines().filter((l) => l.indexOf('指南：') === 0).length === idleAfter,
        String(lines().filter((l) => l.indexOf('指南：') === 0).length));
      type('cmd-input', '/exit');
      await sleep(300);
      const coverIdle = lines().filter((l) => l.indexOf('指南：') === 0).length;
      peek('lastActionAt = Date.now() - 400000');
      await sleep(800);
      ok('封面(未运行)不提示', lines().filter((l) => l.indexOf('指南：') === 0).length === coverIdle);

      console.log('\n【J. 成就:不该触发的不会触发】');
      const got = () => peek('JSON.stringify(game.achievements)');
      ok('拿到的是可获得的那几个(3~5 个)', peek('game.achievements').length >= 3 && peek('game.achievements').length <= 5, got());
      ok('scan / 结局 / 作者的话类成就未误触发',
        ['first_frag', 'wireless', 'echo_tower', 'whole_earth', 'gravekeeper', 'star_wanderer', 'authors_note']
          .every((id) => peek('game.achievements').indexOf(id) < 0));
      doc.getElementById('btn-achievements').click();
      await sleep(150);
      ok('封面成就页只显示已获得的', doc.getElementById('ach-list').textContent.indexOf('我们开始思考') >= 0
        && doc.getElementById('ach-list').textContent.indexOf('回声塔') < 0);
      ok('计数与成就数一致', doc.getElementById('ach-count').textContent
        .indexOf(peek('game.achievements').length + ' / 10') >= 0, doc.getElementById('ach-count').textContent);
      doc.getElementById('btn-ach-back').click();
      await sleep(150);
      ok('成就页能返回封面', !hidden('cover') && hidden('achievements'));

      console.log('\n【K. 存档 / 迁移 / 损坏】');
      ok('自动存档间隔 = 60 秒', peek('D.numbers.autosaveSec') === 60);
      peek('writeSave(snapshot())');
      const saved = JSON.parse(w.localStorage.getItem('vn-01-save'));
      ok('存档含 unlocked / achievements', saved.unlocked.length === 2 && saved.achievements.length === 3,
        JSON.stringify(saved.unlocked) + ' ' + JSON.stringify(saved.achievements));
      doc.getElementById('btn-load').click();
      await sleep(400);
      ok('读档后科技还在(按钮也在)', peek('game.unlocked').length === 2 && !!doc.getElementById('btn-mine')
        && !!doc.getElementById('btn-replicate'));
      ok('读档后成就还在', peek('game.achievements').length === 3);
      ok('读档出现「以前的信息」', lines().some((l) => l.indexOf('以前的信息') >= 0));
      peek("applySave({ material: 5, probes: 6, timeSec: 60, fired: [] })");
      ok('旧档(无 unlocked/achievements 字段)不报错、unlocked 归零', peek('game.unlocked').length === 0);
      ok('旧档不会清空成就(V0.1.5 起成就是账号级的)', peek('game.achievements').length > 0,
        String(peek('game.achievements').length));
      peek('checkAchievements()');
      ok('旧档续玩会补发已达成的成就', peek('game.achievements').indexOf('first_rep') >= 0,
        got());
      w.localStorage.setItem('vn-01-save', '{{{ 坏档');
      ok('坏档 → readSave 返回 null(不崩)', peek('readSave()') === null);
      w.localStorage.setItem('vn-01-save', JSON.stringify({ active: true }));
      ok('残缺档 → readSave 仍能解析', peek('readSave()') !== null);

      console.log('\n【L. 剧情回归(老功能没坏)】');
      doc.getElementById('btn-new').click();
      await sleep(10000);   // 等启动序列 + P1/P1b 都打完,队列空了再测折叠
      for (let i = 0; i < 12; i++) type('cmd-input', '/mine');
      await sleep(500);
      ok('重复操作仍然折叠', lines().some((l) => /^\+1 材料 ×\d+$/.test(l)),
        lines().filter((l) => l.indexOf('+1 材料') === 0).join(' | '));
      type('cmd-input', '/replicate');
      const relicEnough = await waitFor(() => doc.querySelectorAll('#log .line.relic').length >= 4, 8000);
      ok('暖色遗物 4 行在位', relicEnough, String(doc.querySelectorAll('#log .line.relic').length));
      ok('第一次复制触发剧情 p2/p3/p4', peek('game.fired').indexOf('p4') >= 0, JSON.stringify(peek('game.fired')));
      const boot = await waitFor(() => peek('game.fired').indexOf('p1') >= 0, 3000);
      ok('启动引导 P1 仍触发', boot);
      ok('开新档不会清空成就', peek('game.achievements').length > 0, String(peek('game.achievements').length));

      console.log('\n【M. 控制台】');
      ok('无任何报错', errors.length === 0, JSON.stringify(errors));

      console.log('\n========== 结果:' + pass + ' 通过 / ' + fail + ' 失败 ==========');
      dom.window.close();
      server.close();
      resolve(fail);
    });
  });
}

run().then((f) => process.exit(f ? 1 : 0));
