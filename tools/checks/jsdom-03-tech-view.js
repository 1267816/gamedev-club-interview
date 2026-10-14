/* ============================================================
   jsdom-03-tech-view.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
// V0.1.1 冒烟测试:科技树视图 / 解锁 / 点击按钮 / 成就 / 闲置提示 / 存读档
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
// 封面版本号要跟 game-data.js 的 version 一致 —— 直接读它,避免测试里"钉死"一个旧版本号
// (2026-10-12:之前三套 jsdom 里都硬编码着 V0.1.2,于是"封面版本号对不对"这条其实一直在检查错的东西)
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

function run() {
  return new Promise(function (resolve) {
    server.listen(8770, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8770/index.html', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      });
      dom.window.addEventListener('error', function (e) { errors.push('window.error: ' + e.message); });
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      const w = dom.window, doc = w.document;
      const peek = (expr) => w.eval(expr);
      const logLines = () => [].map.call(doc.querySelectorAll('#log .line'), (e) => e.textContent);
      const hidden = (id) => doc.getElementById(id).classList.contains('hidden');
      const type = function (inputId, s) {
        const inp = doc.getElementById(inputId);
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      const key = function (el, k) {
        (el || doc).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      };
      // V0.1.3 起选中项按"节点身份"记,不再用列表序号 —— 测试也改用真实鼠标选中
      const clickRowByName = function (name) {
        const r = [].slice.call(doc.querySelectorAll('#tech-list .tech-item'))
          .find((x) => x.querySelector('.t-name').textContent.indexOf(name) === 0);
        if (!r) throw new Error('找不到节点:' + name);
        r.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      };
      // V0.2.0:解锁 = 先立项,研究一段时间才真解锁。测试不真等 20~85 秒,
      // 直接把这个项目的 "开始时刻" 拨到过去,让下一帧就完成(tick 里是现算的)
      const finishResearch = function () {
        w.eval('if (game.research) game.research.startSec = game.timeSec - 9999;');
      };
      const ok = (label, cond, extra) => console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  → ' + extra : ''));
      // 日志是排队打字的,断言要等它落到 DOM 上
      const waitFor = async function (cond, ms) {
        const t0 = Date.now();
        while (Date.now() - t0 < (ms || 6000)) {
          if (cond()) return true;
          await sleep(120);
        }
        return cond();
      };

      await sleep(300);
      ok('封面版本号与 game-data.js 一致(' + GAME_VERSION + ')',
        doc.getElementById('cover-version').textContent.indexOf(GAME_VERSION) >= 0,
        doc.getElementById('cover-version').textContent);
      ok('封面有 [ 成就 ] 按钮', !!doc.getElementById('btn-achievements'));

      w.eval('window.__skipAudioNotice = true'); doc.getElementById('btn-new').click();
      await sleep(6000);
      ok('侧栏出现「科技 0 / 14」', doc.getElementById('readout').textContent.indexOf('0 / 14') >= 0,
        doc.getElementById('readout').textContent.trim().slice(0, 60));
      ok('命令按钮里没有 /mine(未解锁)', !doc.getElementById('btn-mine'));
      ok('命令按钮里有 /research', !!doc.getElementById('btn-research'));

      // 打开科技树
      type('cmd-input', '/research');
      await sleep(200);
      ok('科技树视图已显示', !hidden('tech') && hidden('screen'));
      const rows = () => doc.querySelectorAll('#tech-list .tech-item').length;
      ok('列表渲染出 20 个节点(14 科技 + 6 建筑/模块)', rows() === 20, String(rows()));
      ok('计数正确', doc.getElementById('tech-count').textContent.indexOf('0 / 14') >= 0,
        doc.getElementById('tech-count').textContent);

      // 筛选:状态=可解锁
      const chips = [].slice.call(doc.querySelectorAll('#tech-status .chip'));
      const readyChip = chips.find((c) => c.textContent === '可解锁');
      readyChip.onclick();
      await sleep(80);
      ok('筛选「可解锁」只剩 1 项(简单采集)', rows() === 1 && doc.querySelector('#tech-list .t-name').textContent === '简单采集',
        doc.querySelector('#tech-list .tech-item').textContent.trim().slice(0, 40));
      chips.find((c) => c.textContent === '全部').onclick();
      await sleep(80);

      // 搜索
      const search = doc.getElementById('tech-search');
      search.value = '语义';
      search.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(80);
      ok('文本筛选「语义」只剩 1 项', rows() === 1 && doc.querySelector('#tech-list .t-name').textContent === '语义重构');
      search.value = '';
      search.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(80);

      // 未上线节点的解释
      const wipRow = [].slice.call(doc.querySelectorAll('#tech-list .tech-item'))
        .find((r) => r.textContent.indexOf('星际航行') === 0);
      ok('「星际航行」是锁定态(V0.1.3 起它上线了,效果藏着)', wipRow && wipRow.className.indexOf('st-locked') >= 0,
        wipRow && wipRow.className);

      // 材料不够时解锁 → 提示
      w.eval('game.material = 10');
      clickRowByName('简单采集');
      key(doc.getElementById('tech-list'), 'Enter');
      await sleep(80);
      ok('材料不足时给出提示', doc.getElementById('tech-hint').textContent.indexOf('资源不足') >= 0,
        doc.getElementById('tech-hint').textContent);
      ok('未扣材料、未解锁', peek('game.material') < 12 && peek('game.unlocked').length === 0,
        String(Math.round(peek('game.material'))));

      // 够钱 → 解锁「简单采集」
      w.eval('game.material = 190');   // 仓库上限 200:材料放不到 500
      key(doc.getElementById('tech-list'), 'Enter');
      await sleep(200);
      // V0.2.0:立项时先扣钱、进入"研究中",研究做完才解锁
      ok('立项成功(材料已扣、进入研究中)',
        peek('game.research && game.research.id') === 'click_mine' && peek('game.unlocked').length === 0,
        String(peek('game.research && game.research.id')));
      // V0.2.9:第一项科技的花费不再写死(40 → 25),从数据表现算
      ok('扣掉「简单采集」的花费(190 − 花费 + 自动产出)',
        peek('game.material') < 190 - peek('techOf("click_mine").cost.material') + 12
        && peek('game.material') > 190 - peek('techOf("click_mine").cost.material') - 12,
        String(Math.round(peek('game.material'))));
      finishResearch();
      await sleep(200);
      ok('研究完成后解锁', peek('game.unlocked').join(',') === 'click_mine', peek('game.unlocked').join(','));
      ok('科技计数变成 1 / 14', doc.getElementById('tech-count').textContent.indexOf('1 / 14') >= 0);
      ok('终端里出现研究完成日志', await waitFor(() => logLines().some((l) => l.indexOf('> 研究完成 简单采集') >= 0), 20000),
        logLines().slice(-2).join(' | '));
      const gotFirstTech = await waitFor(() => logLines().some((l) => l.indexOf('你获得了一个成就：我们开始思考') >= 0));
      ok('获得成就「我们开始思考」(终端弹出)', peek('game.achievements').indexOf('first_tech') >= 0 && gotFirstTech,
        JSON.stringify(peek('game.achievements')));
      ok('解锁后出现 [ /mine ] 按钮', !!doc.getElementById('btn-mine'));

      // /back 返回终端(用科技树里的那个输入行)
      type('tech-input', '/back');
      await sleep(200);
      ok('/back 回到终端', !hidden('screen') && hidden('tech'));

      // 点击按钮能用
      w.eval('game.material = 20');   // 先腾出空间:仓库满了材料就涨不动了
      const before = peek('game.material');
      doc.getElementById('btn-mine').click();
      await sleep(150);
      ok('点击 [ /mine ] 材料 +1', peek('game.material') - before > 0.9, (peek('game.material') - before).toFixed(2));

      // 继续解锁「批量复制」(140)
      w.eval('game.material = 190');
      type('cmd-input', '/research');
      await sleep(150);
      clickRowByName('批量复制');
      key(doc.getElementById('tech-list'), 'Enter');
      await sleep(200);
      finishResearch();
      await sleep(200);
      ok('批量复制解锁 + 成就「不必再打字」', peek('game.unlocked').indexOf('click_rep') >= 0
        && peek('game.achievements').indexOf('no_more_typing') >= 0);
      ok('出现 [ /replicate ] 按钮', !!doc.getElementById('btn-replicate'));

      // 存读档:解锁状态要保留
      key(doc, 'Escape');
      await sleep(120);
      ok('Esc 也能返回终端', !hidden('screen'));
      w.eval('writeSave(snapshot())');
      const saved = JSON.parse(w.localStorage.getItem('vn-01-save'));
      ok('存档里带 unlocked / achievements', Array.isArray(saved.unlocked) && saved.unlocked.length === 2
        && Array.isArray(saved.achievements), JSON.stringify(saved.unlocked));

      // 闲置提示:把 lastActionAt 拨回 3 分钟前
      w.eval('lastActionAt = Date.now() - 200000');
      const gotIdle = await waitFor(() => logLines().some((l) => l.indexOf('指南：') === 0), 8000);
      ok('闲置后指南系统提示一句', gotIdle,
        logLines().filter((l) => l.indexOf('指南：') === 0)[0]);

      // 封面成就页
      type('cmd-input', '/exit');
      await sleep(300);
      doc.getElementById('btn-achievements').click();
      await sleep(150);
      ok('封面成就页打开', !hidden('achievements'));
      const achText = doc.getElementById('ach-list').textContent;
      ok('只显示已获得的成就(隐藏未获得)', achText.indexOf('我们开始思考') >= 0
        && achText.indexOf('回声塔') < 0, achText.slice(0, 60));
      ok('成就计数 2 / 9(V0.2.6:「作者的话」成就已删)', doc.getElementById('ach-count').textContent.indexOf('2 / 9') >= 0,
        doc.getElementById('ach-count').textContent);

      console.log('\n控制台报错:', errors.length ? JSON.stringify(errors, null, 1) : '无');
      console.log('日志最后 8 行:\n  ' + logLines().slice(-8).join('\n  '));
      dom.window.close();
      server.close();
      resolve();
    });
  });
}

run().then(() => process.exit(0));
