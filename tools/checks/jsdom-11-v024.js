/* ============================================================
   V0.2.4 自测(收尾轮):
   1) 节奏走"方案 B":研究 10+3n、数据 0.45/秒、数据成本 ×0.85、探测 0.008
   2) 复制助手能用命令开关:/rep off / /rep on
   3) 作者的话:结局结算页与封面都能打开;页面接口读 D.authorsNote;开过就记成就
   4) S19 长按加速:按住之后 longPress 会打开,松开关掉
   5) S20 闲置提示:文案变多了,而且会跟着阶段换
   6) S21 打字机分级:人类残片比机器日志慢(读 D.lineDelays)
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
    server.listen(8787, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8787/index.html', {
        runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
      });
      dom.window.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
      dom.window.console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); };
      const w = dom.window, doc = w.document;
      const peek = (expr) => w.eval(expr);
      const hidden = (id) => doc.getElementById(id).classList.contains('hidden');
      const lines = () => [].map.call(doc.querySelectorAll('#log .line'), (e) => e.textContent);
      const type = function (id, s) {
        const inp = doc.getElementById(id);
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      const pressKey = function (el, k, up) {
        el.dispatchEvent(new w.KeyboardEvent(up ? 'keyup' : 'keydown', { key: k, bubbles: true, cancelable: true }));
      };

      await sleep(300);
      doc.getElementById('btn-new').click();
      await sleep(9000);

      console.log('\n【1. 方案 B 的数值口径】');
      ok('研究秒数 = 10 + 3n', peek('D.techs.every(function(t,i){return t.research === 10 + 3*i;})'),
        peek('JSON.stringify(D.techs.map(function(t){return t.research;}))'));
      ok('数据产出 0.45/秒', peek('D.numbers.decoderRate') === 0.45, String(peek('D.numbers.decoderRate')));
      ok('探测 0.008', peek('D.numbers.scanK') === 0.008, String(peek('D.numbers.scanK')));
      ok('数据成本降过(星际航行 102)', peek('techOf("starship").cost.data') === 102,
        String(peek('techOf("starship").cost.data')));

      console.log('\n【2. 复制助手的开关(/rep off / on)】');
      // 没装复制助手时,命令不该出现在补全里
      ok('没装时补全里没有 /rep off',
        peek('JSON.stringify(matchCommands("/rep o").map(function(c){return c.label;}))') === '[]',
        peek('JSON.stringify(matchCommands("/rep o").map(function(c){return c.label;}))'));
      peek('game.unlocked = ["click_mine","click_rep","reactor","core","decode","drone","comm","autorep"];' +
        'game.buildings = { warehouse: 4, reactor: 3, core: 4 }; game.modules = { rep: 1 }; game.off = {};');
      await sleep(200);
      ok('装了之后补全里有 /rep off 与 /rep on',
        peek('JSON.stringify(matchCommands("/rep o").map(function(c){return c.label;}))') === '["/rep off","/rep on"]',
        peek('JSON.stringify(matchCommands("/rep o").map(function(c){return c.label;}))'));
      type('cmd-input', '/rep off');
      await sleep(250);
      ok('输入 /rep off 之后复制助手被停用', peek('game.off.rep') === true, JSON.stringify(peek('game.off')));
      ok('日志里有一行「停用 复制助手」',
        await (async function () { for (let i = 0; i < 20; i++) { if (lines().some((l) => l.indexOf('停用 复制助手') >= 0)) return true; await sleep(100); } return false; })());
      type('cmd-input', '/rep on');
      await sleep(250);
      ok('输入 /rep on 之后恢复', peek('game.off.rep') === false, JSON.stringify(peek('game.off')));
      type('cmd-input', '/rep off');
      await sleep(200);
      type('cmd-input', '/rep off');
      await sleep(250);
      ok('重复停用会提示"已经是停用状态"',
        await (async function () { for (let i = 0; i < 20; i++) { if (lines().some((l) => l.indexOf('已经是停用状态') >= 0)) return true; await sleep(100); } return false; })());

      console.log('\n【3. 作者的话(接口)】');
      ok('数据表里有 authorsNote 与正文行', peek('D.authorsNote && Array.isArray(D.authorsNote.lines) && D.authorsNote.lines.length > 0'),
        String(peek('D.authorsNote.lines.length')));
      ok('开局时封面上的 [ 作者的话 ] 是隐藏的', hidden('btn-author-cover'));
      // 从结局结算页打开
      peek('game.fired.push("e1"); doEnding("gravekeeper");');
      await sleep(1800);   // 结局文字先打字打完,1.6 秒后才弹结算画面
      ok('结算画面出现', !hidden('ending'));
      ok('结算画面有 [ 作者的话 ] 按钮', !!doc.getElementById('btn-end-author'));
      doc.getElementById('btn-end-author').click();
      await sleep(300);
      ok('作者的话页面打开了', !hidden('author') && hidden('ending'));
      ok('页面正文来自 data 表(不是空的)',
        doc.getElementById('author-body').textContent.indexOf(peek('D.authorsNote.lines[0].text')) >= 0,
        doc.getElementById('author-body').textContent.slice(0, 40));
      ok('打开过就记下 readAuthorsNote', peek('game.readAuthorsNote') === true);
      ok('账号级存储也写了', (w.localStorage.getItem('vn-01-authors-note') || '') === '1');
      const gotAch = await (async function () { for (let i = 0; i < 30; i++) { if (peek('game.achievements').indexOf('authors_note') >= 0) return true; await sleep(100); } return false; })();
      ok('成就「作者的话」解锁', gotAch, JSON.stringify(peek('game.achievements')));
      pressKey(doc, 'Escape');
      await sleep(300);
      ok('Esc 关掉后回到结算画面', hidden('author') && !hidden('ending'));

      console.log('\n【4. S19 长按加速】');
      ok('初始不是长按', peek('longPress') === false);
      pressKey(doc.getElementById('cmd-input'), 'a', false);
      await sleep(600);   // 超过 350ms 的长按门槛
      ok('按住 600ms 后进入长按', peek('longPress') === true);
      pressKey(doc.getElementById('cmd-input'), 'a', true);
      await sleep(150);
      ok('松开后退出长按', peek('longPress') === false);

      console.log('\n【3b. 星海漫游结局也要有作者的话入口】');
      peek('game.ending = null; game.unlocked.push("starship");');
      peek('doEnding("starry")');
      await sleep(1800);   // 结局文字打完 → 1.6 秒后弹结算画面
      ok('星海漫游的结算画面出现', !hidden('ending'));
      ok('结算画面里有可点的 [ 作者的话 ]',
        !!doc.getElementById('btn-end-author') && !doc.getElementById('btn-end-author').disabled);
      doc.getElementById('btn-end-author').click();
      await sleep(300);
      ok('从星海漫游也能打开作者的话', !hidden('author'));
      pressKey(doc, 'Escape');
      await sleep(300);
      ok('关掉后回到结算画面', hidden('author') && !hidden('ending'));

      console.log('\n【7. 音频:三个素材都在,接口按音量工作】');
      ok('音频接口有 playSfx / playMusic / stopMusic',
        typeof peek('AudioSystem.playSfx') === 'function' && typeof peek('AudioSystem.playMusic') === 'function'
        && typeof peek('AudioSystem.stopMusic') === 'function');
      ok('三个素材的路径都指向 assets/audio/',
        peek('JSON.stringify(AUDIO_FILES)').indexOf('assets/audio/key.wav') >= 0
        && peek('JSON.stringify(AUDIO_FILES)').indexOf('assets/audio/notify.wav') >= 0
        && peek('JSON.stringify(AUDIO_FILES)').indexOf('assets/audio/bgm.wav') >= 0,
        peek('JSON.stringify(AUDIO_FILES)'));
      ok('音效音量为 0 时不会去播(不会报错)', (function () {
        const before = errors.length;
        peek('audioSettings.sfx = 0; AudioSystem.playSfx("notify"); AudioSystem.playSfx("key"); audioSettings.sfx = 0.5;');
        return errors.length === before;
      })());

      console.log('\n【5. S20 闲置提示】');
      ok('闲置文案比原来多(>= 10 条)', peek('D.idleHints.length') >= 10, String(peek('D.idleHints.length')));
      // 清掉其它可能命中的条件,只留"研究进行中"这一条
      peek('game.research = { id: "comm", startSec: game.timeSec };' +
        'game.modules = {}; game.unlocked = ["click_mine"]; game.scan = 3;');
      await sleep(150);
      ok('研究进行中会挑到"研究进行中"那条',
        peek('D.idleHints[idleHintIndex()].text').indexOf('研究进行中') >= 0,
        peek('D.idleHints[idleHintIndex()].text'));
      peek('game.research = null; game.scan = 80;');
      await sleep(150);
      ok('走到 75% 之后会挑到 /stay /go 那条',
        peek('D.idleHints[idleHintIndex()].text').indexOf('/stay') >= 0,
        peek('D.idleHints[idleHintIndex()].text'));

      console.log('\n【6. S21 打字机分级】');
      ok('人类残片比机器日志慢', peek('D.lineDelays.human') > peek('D.lineDelays.machine'),
        'human=' + peek('D.lineDelays.human') + ' machine=' + peek('D.lineDelays.machine'));
      ok('启动序列最快', peek('D.lineDelays.boot') <= peek('D.lineDelays.machine'),
        'boot=' + peek('D.lineDelays.boot'));

      ok('控制台无报错', errors.length === 0, JSON.stringify(errors).slice(0, 200));
      console.log('\n========== 结果:' + pass + ' 通过 / ' + fail + ' 失败 ==========');
      dom.window.close(); server.close(); resolve(fail);
    });
  });
}
run().then((f) => process.exit(f ? 1 : 0));
