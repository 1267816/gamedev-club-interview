/* ============================================================
   chrome-03-tech-ending.js
   这是开发自测脚本,不是游戏的一部分(浏览器不加载)。
   jsdom 系列:先在本目录执行一次 `npm i jsdom`,然后 `node <文件名>`;
   也可以用 `node run-all.js` 一次跑完所有 jsdom 套件。
   chrome 系列:需要本机有 Chrome(默认路径见文件内 CHROME,可用环境变量 CHROME 覆盖)。
   ============================================================ */
// 真 Chrome:V0.1.3 科技树(新排序/停用态/资源读数)+ 结局结算画面
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const OUT = process.argv[2] || path.join(os.tmpdir(), 'vn013.png');
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
  await new Promise((r) => server.listen(8781, '127.0.0.1', r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vn013-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=9339', '--window-size=1400,900',
    '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch('http://127.0.0.1:9339/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0; const pending = new Map(); const logs = [];
  ws.onmessage = function (ev) {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception || {}).description);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + m.params.args.map((a) => a.value).join(' '));
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
  const ok = (label, cond, extra) => console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  → ' + extra : ''));

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8781/index.html' });
  await sleep(1200);
  await js('localStorage.clear(); sessionStorage.clear()');
  await send('Page.navigate', { url: 'http://127.0.0.1:8781/index.html' });
  await sleep(1500);
  await js("window.__skipAudioNotice=true;document.getElementById('btn-new').click()");
  await sleep(6000);
  await js("game.unlocked = ['click_mine','click_rep','reactor','core','decode','drone','comm','autorep'];");
  await js("game.buildings = { warehouse: 4, reactor: 5, core: 3 }; game.modules = { decoder: 2, drone: 2, rep: 1 };");
  await js("game.probes = 34; game.scan = 41.5; game.data = 12.4; game.material = 640; game.off = {};");
  await sleep(500);
  await js("(function(){var i=document.getElementById('cmd-input');i.value='/research';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true,bubbles:true}));})()");
  await sleep(500);
  await shot('-tech');
  ok('科技树右侧有读数面板(V0.1.4:直接复用终端那块)', (await js("document.getElementById('readout-tech').textContent")).indexOf('材料') >= 0,
    await js("document.getElementById('readout-tech').textContent.slice(0,60)"));
  ok('顶部不再重复显示材料', (await js("document.getElementById('tech-header').textContent")).indexOf('材料') < 0);
  ok('已解锁的沉到底部', (await js("[].map.call(document.querySelectorAll('#tech-list .tech-item'),function(r){return r.className}).slice(-4).join(' ')")).indexOf('st-done') >= 0);
  // 停用一个模块,看"已停止"
  await js("techSelKey = 'module:rep'"); await sleep(200);
  await js("document.getElementById('tech-list').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))");
  await sleep(400);
  ok('空格停用模块:列表出现"已停止"', (await js("[].map.call(document.querySelectorAll('#tech-list .tech-item'),function(r){return r.textContent}).join('')")).indexOf('已停止') >= 0);
  await shot('-tech-stopped');
  ok('停用写入状态', (await js('JSON.stringify(game.off)')).indexOf('true') > 0, await js('JSON.stringify(game.off)'));

  // 结局:直接压到 75%
  // V0.2.13:先把"75% 之前本该触发"的剧情节点静默标记为已触发 —— 否则 scan 从 0 跳到 75
  // 会把 58 行剧情一次性冲进打字机队列(要打 55 秒),结算画面要等到队列排干才弹,
  // 这个套件的 60 秒轮询会来不及。只留 75% 那三个节点(残片 007 / 008 / 回声塔 e1)。
  await js("D.story.filter(function(n){return ['frag9','frag4','e1'].indexOf(n.id) < 0;})" +
    ".forEach(function(n){ if (game.fired.indexOf(n.id) < 0) game.fired.push(n.id); });");
  await js("game.data = 500; game.unlocked.push('starship','bootstrap');");
  await js("game.scan = 75");
  await sleep(1500);
  ok('75% 后出现 [ /stay ] 与 [ /go ] 按钮', await js("!!document.getElementById('btn-stay') && !!document.getElementById('btn-go')"));
  await shot('-ending-choice');
  await js("(function(){var i=document.getElementById('tech-input');i.value='/back';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true,bubbles:true}));})()");
  await sleep(400);
  await js("document.getElementById('btn-go').click()");
  // V0.2.6:结局是一段长文,打完才弹结算画面 —— 这里轮询等它出现(最多 60 秒)
  for (let i = 0; i < 240; i++) {
    if (await js("!document.getElementById('ending').classList.contains('hidden')")) break;
    await sleep(500);
  }
  ok('结算画面出现', await js("!document.getElementById('ending').classList.contains('hidden')"),
    await js("document.getElementById('end-title').textContent"));
  const centered = await js("(function(){var p=document.querySelector('#ending .panel').getBoundingClientRect();" +
    "return Math.abs((p.left+p.width/2) - window.innerWidth/2) < 40 && p.width < window.innerWidth*0.8;})()");
  ok('结算面板居中(不是铺满整屏)', centered,
    'panel 宽 ' + await js("Math.round(document.querySelector('#ending .panel').getBoundingClientRect().width)")
    + ' / 窗口 ' + await js("window.innerWidth"));
  ok('结算面板顶部不在 0(说明是垂直居中的)', await js("document.querySelector('#ending .panel').getBoundingClientRect().top") > 40,
    String(await js("Math.round(document.querySelector('#ending .panel').getBoundingClientRect().top)")));
  await shot('-ending');
  console.log('控制台报错:', logs.length ? JSON.stringify(logs, null, 1) : '无');
  chrome.kill(); server.close(); process.exit(logs.length ? 1 : 0);
}
main();
