/* ============================================================
   chrome-01-layout.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
// 真 Chrome 终检:封面 / 科技树 / 成就页 / 小窗口布局 / 控制台报错
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const OUT = process.argv[2] || path.join(os.tmpdir(), 'vn011-chrome.png');
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
  await new Promise((r) => server.listen(8773, '127.0.0.1', r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vn011-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9336', '--window-size=1400,900', '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch('http://127.0.0.1:9336/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = function (ev) {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception || {}).description);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++seq; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
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
  const results = [];
  const ok = (label, cond, extra) => {
    results.push({ label, cond, extra });
    console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  → ' + extra : ''));
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8773/index.html' });
  await sleep(1200);
  await js('localStorage.clear(); sessionStorage.clear()');
  await send('Page.navigate', { url: 'http://127.0.0.1:8773/index.html' });
  await sleep(1500);

  ok('封面无横向溢出', await js('document.documentElement.scrollWidth <= window.innerWidth'));
  await shot('-cover');

  await js("document.getElementById('btn-new').click()");
  await sleep(6000);
  await js('game.material = 900');
  await js("(function(){var i=document.getElementById('cmd-input');i.value='/research';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true,bubbles:true}));})()");
  await sleep(400);
  ok('科技树:列表 20 行(14 科技 + 6 建筑/模块)',
    await js("document.querySelectorAll('#tech-list .tech-item').length") === 20,
    String(await js("document.querySelectorAll('#tech-list .tech-item').length")));
  ok('科技树:无横向溢出', await js('document.documentElement.scrollWidth <= window.innerWidth'));
  ok('科技树:1400×900 下列表可滚动(20 行放不下)', await js("(function(){var l=document.getElementById('tech-list');return l.scrollHeight>l.clientHeight;})()"),
    '内容高 ' + await js("document.getElementById('tech-list').scrollHeight") + ' / 容器高 ' + await js("document.getElementById('tech-list').clientHeight"));

  // 立项「简单采集」,看选中项是否钉住 + 按钮状态(V0.2.0:解锁 = 立项 → 研究 → 完成)
  await js("(function(){var r=[].slice.call(document.querySelectorAll('#tech-list .tech-item')).find(function(x){return x.textContent.indexOf('简单采集')===0});r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));})()");
  await sleep(200);
  await js("document.querySelector('#tech-detail .unlock-btn').click()");
  await sleep(600);
  ok('立项后选中项仍是这个节点',
    (await js("(document.querySelector('#tech-list .tech-item.active')||{}).textContent||''")).indexOf('简单采集') === 0,
    await js("(document.querySelector('#tech-list .tech-item.active')||{}).textContent"));
  ok('立项后按钮变成 [ 研究中… ] 且禁用', await js("document.querySelector('#tech-detail .unlock-btn').textContent") === '[ 研究中… ]'
    && await js("document.querySelector('#tech-detail .unlock-btn').disabled"),
    await js("document.querySelector('#tech-detail .unlock-btn').textContent"));
  await js("debugAdvanceResearch(9999)");
  await sleep(400);
  ok('解锁按钮变 [ 已解锁 ] 且禁用', await js("document.querySelector('#tech-detail .unlock-btn').textContent") === '[ 已解锁 ]'
    && await js("document.querySelector('#tech-detail .unlock-btn').disabled"));
  ok('出现 [ /mine ] 按钮', await js("!!document.getElementById('btn-mine')"));
  await shot('-tech');

  // 小窗口(900×600)看布局
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  ok('900×600 下科技树无横向溢出', await js('document.documentElement.scrollWidth <= window.innerWidth'),
    'scrollWidth=' + await js('document.documentElement.scrollWidth'));
  await shot('-tech-small');
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  // 回终端 + 成就页
  await js("(function(){var i=document.getElementById('tech-input');i.value='/back';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true,bubbles:true}));})()");
  await sleep(600);
  ok('/back 回到终端', await js("!document.getElementById('screen').classList.contains('hidden')"));
  await js("document.getElementById('btn-exit')?(document.getElementById('btn-exit').click()):0");
  await sleep(800);
  await js("document.getElementById('btn-achievements').click()");
  await sleep(400);
  ok('成就页:计数与内容', (await js("document.getElementById('ach-count').textContent")).indexOf('/ 9') >= 0,
    await js("document.getElementById('ach-count').textContent"));
  await shot('-ach');

  // 横屏窄窗(1100×520)再看一次 —— 矮窗最容易露馅
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 520, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await js("document.getElementById('btn-ach-back').click()");
  await js("document.getElementById('btn-load').click()");
  await sleep(600);
  await js("(function(){var i=document.getElementById('cmd-input');i.value='/research';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true,bubbles:true}));})()");
  await sleep(600);
  ok('1100×520 下科技树无横向溢出', await js('document.documentElement.scrollWidth <= window.innerWidth'));
  ok('1100×520 下列表仍可见且有高度', await js("document.getElementById('tech-list').clientHeight") > 60,
    'h=' + await js("document.getElementById('tech-list').clientHeight"));
  ok('1100×520 下列表可滚动(内容超出)', await js("(function(){var l=document.getElementById('tech-list');return l.scrollHeight>l.clientHeight;})()"),
    await js("document.getElementById('tech-list').scrollHeight") + ' > ' + await js("document.getElementById('tech-list').clientHeight"));
  await shot('-tech-short');

  console.log('\n控制台报错:', logs.length ? JSON.stringify(logs, null, 1) : '无');
  const failed = results.filter((r) => !r.cond).length;
  console.log('结果:' + (results.length - failed) + ' 通过 / ' + failed + ' 失败');
  chrome.kill();
  server.close();
  process.exit(failed ? 1 : 0);
}
main();
