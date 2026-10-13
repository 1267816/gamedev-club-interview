/* ============================================================
   jsdom-02-save-load.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
// 存档 / 加载路径的冒烟测试:刷新续玩、关窗重开、旧存档(V0.0.8,无 fired)兜底。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

const server = http.createServer(function (req, res) {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  fs.readFile(path.join(ROOT, rel), function (err, buf) {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream' });
    res.end(buf);
  });
});

const save = function (extra) {
  return JSON.stringify(Object.assign({
    v: 'V0.1.0', savedAt: Date.now(), active: true,
    material: 42, probes: 3, timeSec: 120, commandsRun: 12,
    fired: ['p1', 'p1b', 'p2', 'p3', 'p4'],
    importantLog: [{ text: '检测到操作者。', cls: '' }],
    logHistory: [{ text: '接收到特定信号', cls: '' }, { text: '+1 材料 ×10', cls: 'dim' }],
  }, extra));
};

async function open(init) {
  const errors = [];
  const dom = await JSDOM.fromURL('http://127.0.0.1:8765/index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse: function (window) {
      if (init && init.save) window.localStorage.setItem('vn-01-save', init.save);
      if (init && init.alive) window.sessionStorage.setItem('vn-01-alive', '1');
    },
  });
  dom.window.onerror = function (m) { errors.push('onerror: ' + m); };
  dom.window.console.error = function () { errors.push('console.error: ' + arguments[0]); };
  return { dom: dom, errors: errors };
}

const state = function (dom) {
  const d = dom.window.document;
  const lines = Array.prototype.map.call(d.querySelectorAll('#log .line'), function (el) {
    return el.textContent;
  });
  return {
    screenVisible: !d.getElementById('screen').classList.contains('hidden'),
    coverVisible: !d.getElementById('cover').classList.contains('hidden'),
    fired: dom.window.eval('game.fired'),
    lines: lines,
  };
};

async function main() {
  await new Promise(function (r) { server.listen(8766, '127.0.0.1', r); });

  // A. F5 刷新(active:true + sessionStorage 还活着)→ 直接续玩,整屏日志回来,剧情不重复触发
  let a = await open({ save: save(), alive: true });
  await sleep(1200);
  let sa = state(a.dom);
  console.log('[A] 刷新:screen=', sa.screenVisible, 'cover=', sa.coverVisible);
  console.log('    贴回的日志行:', JSON.stringify(sa.lines));
  console.log('    fired 未重复触发:', JSON.stringify(sa.fired), '| 新增行数应为 0');
  console.log('    错误:', a.errors.length ? a.errors : '无');
  a.dom.window.close();

  // B. 关窗后重开(active:true,但 sessionStorage 是空的)→ 停在封面
  let b = await open({ save: save() });
  await sleep(1200);
  let sb = state(b.dom);
  console.log('[B] 关窗重开:cover=', sb.coverVisible, 'screen=', sb.screenVisible,
    '| 加载存档按钮可点=', !b.dom.window.document.getElementById('btn-load').disabled);
  b.dom.window.document.getElementById('btn-load').click();
  await sleep(1200);
  let sb2 = state(b.dom);
  console.log('    点「加载存档」→ screen=', sb2.screenVisible, '| 日志:',
    JSON.stringify(sb2.lines.slice(0, 4)));
  console.log('    错误:', b.errors.length ? b.errors : '无');
  b.dom.window.close();

  // C. 旧存档(V0.0.8:没有 fired、probes 已经 30)→ 兜底不应刷出一段剧情
  const legacy = JSON.parse(save());
  delete legacy.fired;
  delete legacy.commandsRun;
  legacy.v = 'V0.0.8';
  legacy.probes = 30;
  let c = await open({ save: JSON.stringify(legacy), alive: true });
  await sleep(1200);
  let sc = state(c.dom);
  console.log('[C] 旧存档续玩:screen=', sc.screenVisible, '| fired(兜底后)=', JSON.stringify(sc.fired));
  console.log('    贴回的日志行数:', sc.lines.length, '| 错误:', c.errors.length ? c.errors : '无');
  c.dom.window.close();

  // D. 旧存档,关卡面手动加载
  let d = await open({ save: JSON.stringify(legacy) });
  await sleep(800);
  d.dom.window.document.getElementById('btn-load').click();
  await sleep(1500);
  let sd = state(d.dom);
  console.log('[D] 旧存档手动读档:日志=', JSON.stringify(sd.lines.slice(0, 6)));
  console.log('    fired=', JSON.stringify(sd.fired), '| 错误:', d.errors.length ? d.errors : '无');
  d.dom.window.close();

  server.close();
}

main().then(function () { process.exit(0); });
