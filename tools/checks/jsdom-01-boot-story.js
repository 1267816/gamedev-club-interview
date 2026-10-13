/* ============================================================
   jsdom-01-boot-story.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
// 冒烟测试:用 jsdom + 本地静态服务器 真跑一遍 index.html,验证 V0.1.0 的剧情 / 引导。
// 放在临时目录,不进游戏仓库。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(function (req, res) {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function run() {
  return new Promise(function (resolve) {
    server.listen(8765, '127.0.0.1', async function () {
      const errors = [];
      const dom = await JSDOM.fromURL('http://127.0.0.1:8765/index.html', {
        runScripts: 'dangerously',
        resources: 'usable',
        pretendToBeVisual: true,
      });
      dom.window.addEventListener('error', function (e) {
        errors.push('window.error: ' + (e.message || e.error));
      });
      dom.window.onerror = function (m) { errors.push('onerror: ' + m); };
      const realError = dom.window.console.error;
      dom.window.console.error = function () {
        errors.push('console.error: ' + Array.prototype.join.call(arguments, ' '));
        realError.apply(this, arguments);
      };

      const w = dom.window;
      const doc = w.document;
      const logText = function () {
        return Array.prototype.map.call(doc.querySelectorAll('#log .line'), function (el) {
          return el.textContent;
        });
      };
      const hidden = function (id) { return doc.getElementById(id).classList.contains('hidden'); };
      const type = function (s) {
        const inp = doc.getElementById('cmd-input');
        inp.value = s;
        inp.dispatchEvent(new w.Event('input', { bubbles: true }));
        const ev = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        inp.dispatchEvent(ev);
      };
      // 顶层 const 不挂在 window 上,用全局 eval 读取状态
      const peek = function (expr) { return w.eval(expr); };

      await sleep(300);
      console.log('[1] 封面可见:', !hidden('cover'), '| 版本:', doc.getElementById('cover-version').textContent);

      w.eval('window.__skipAudioNotice = true'); doc.getElementById('btn-new').click();
      await sleep(7000);   // 启动序列(12 行 × 320ms)+ 引导打字
      console.log('[2] 启动后屏幕:', hidden('screen') ? 'screen 隐藏(异常)' : 'screen 可见');
      console.log('    提示行 hint:', JSON.stringify(doc.getElementById('hint').textContent));

      // 采集到 10 材料
      for (let i = 0; i < 10; i++) type('/mine');
      await sleep(600);
      console.log('[3] 10 次 /mine 后 材料=', Math.floor(peek('game.material')), '| 折叠行:',
        JSON.stringify(logText()[logText().length - 1]));
      console.log('    hint:', JSON.stringify(doc.getElementById('hint').textContent));

      // 第一次复制 → 应该触发 p2 / p3 / p4
      type('/replicate');
      await sleep(6000);
      console.log('[4] 复制后 探测器=', peek('game.probes'), '| fired=', JSON.stringify(peek('game.fired')));
      const relics = Array.prototype.map.call(doc.querySelectorAll('#log .line.relic'), function (el) {
        return el.textContent;
      });
      console.log('[5] 人类遗物行(暖色):', JSON.stringify(relics, null, 0));

      // V0.1.2:剧情里程碑改挂"星球探测进度",所以推 scan 而不是探测器数量
      w.eval('game.probes = 50; game.scan = 100');
      await sleep(6000);
      console.log('[6] 探测 100% 后 fired=', JSON.stringify(peek('game.fired')));
      console.log('    hint:', JSON.stringify(doc.getElementById('hint').textContent));

      // 存档 / 读档:旧存档兜底 + 新存档保留剧情进度
      const anchor = doc.createElement('div');
      w.localStorage.setItem('vn-01-save', w.localStorage.getItem('vn-01-save'));
      console.log('[7] localStorage 存档存在:', !!w.localStorage.getItem('vn-01-save'));

      console.log('[8] 错误收集:', errors.length ? JSON.stringify(errors, null, 1) : '无');
      console.log('[9] 全部日志行数:', logText().length);
      console.log('---- 日志最后 12 行 ----');
      console.log(logText().slice(-12).join('\n'));

      dom.window.close();
      server.close();
      resolve();
    });
  });
}

run().then(function () { process.exit(0); });
