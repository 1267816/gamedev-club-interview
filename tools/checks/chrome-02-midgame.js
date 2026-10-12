/* ============================================================
   chrome-02-midgame.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
// 真 Chrome:V0.1.2 的经济界面(科技树里的可建造行 + 终端面板)截图与报错检查
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const OUT = process.argv[2] || path.join(os.tmpdir(), 'vn012.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer(function (req, res) {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  fs.readFile(path.join(ROOT, rel), function (err, buf) {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream' });
    res.end(buf);
  });
});
async function main() {
  await new Promise((r) => server.listen(8777, '127.0.0.1', r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vn012-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=9337', '--window-size=1400,900',
    '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch('http://127.0.0.1:9337/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map(); const logs = [];
  ws.onmessage = function (ev) {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + m.params.args.map((a) => a.value).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception || {}).description);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.result && r.result.exceptionDetails) logs.push('eval 异常: ' + r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (suffix) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT.replace(/\.png$/, suffix + '.png'), Buffer.from(r.result.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8777/index.html' });
  await sleep(1200);
  await js('localStorage.clear(); sessionStorage.clear()');
  await send('Page.navigate', { url: 'http://127.0.0.1:8777/index.html' });
  await sleep(1500);
  await js("document.getElementById('btn-new').click()");
  await sleep(6000);
  // 造一个中局状态(只为看 UI;数值本身由 smoke5 验证)
  await js("game.unlocked = ['click_mine','click_rep','reactor','core','decode','drone','comm'];");
  await js("game.buildings = { warehouse: 4, reactor: 5, core: 3 }; game.modules = { decoder: 3, drone: 2, rep: 1 };");
  await js("game.probes = 34; game.scan = 41.5; game.data = 12.4; game.material = 640;");
  await sleep(1200);
  await shot('-play');
  console.log('终端面板已截图');
  console.log('面板文本:', JSON.stringify(await js("document.getElementById('readout').textContent")));

  await js("(function(){var i=document.getElementById('cmd-input');i.value='/research';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true,bubbles:true}));})()");
  await sleep(500);
  await shot('-tech');
  console.log('科技树已截图');
  console.log('列表行数:', await js("document.querySelectorAll('#tech-list .tech-item').length"));
  console.log('可建造行:', await js("[].map.call(document.querySelectorAll('#tech-list .tech-item'),function(r){return r.querySelector('.t-name').textContent+'|'+r.querySelector('.t-status').textContent}).slice(0,6).join(' ; ')"));
  // 在科技树里建一座反应堆(鼠标点 [ 建造 ])
  await js("(function(){var r=[].slice.call(document.querySelectorAll('#tech-list .tech-item')).find(function(x){return x.querySelector('.t-name').textContent.indexOf('反应堆')===0 && x.className.indexOf('st-ready')>=0});r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));})()");
  await sleep(200);
  await js("document.querySelector('#tech-detail .unlock-btn').click()");
  await sleep(600);
  console.log('建造后 buildings:', await js("JSON.stringify(game.buildings)"));
  console.log('提示行:', JSON.stringify(await js("document.getElementById('tech-hint').textContent")));
  await shot('-tech-build');
  console.log('控制台报错:', logs.length ? JSON.stringify(logs, null, 1) : '无');
  chrome.kill(); server.close(); process.exit(logs.length ? 1 : 0);
}
main();
