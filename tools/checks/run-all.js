/* ============================================================
   tools/checks/run-all.js —— 一次跑完所有 jsdom 自测套件

   用法(在本目录):
     npm i jsdom        # 只需要一次
     node run-all.js            # 全量:11 套(交付前跑这个)
     node run-all.js --quick    # 快速:只跑关键几套(改代码时每轮跑它)

   V0.2.7 起**并行跑**(每套自己占一个端口,互不干扰)—— 全量从 ~5 分钟降到 ~1.5 分钟。
   每个套件都会自己开一个本地静态服务器、用 jsdom 真跑一遍 index.html,
   最后打印「通过 / 失败」与失败项。任一失败,退出码为 1。
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const QUICK = process.argv.indexOf('--quick') >= 0;
const CONCURRENCY = 4;   // 同时跑几套;每套一个独立端口,可以并行
// --quick 跳过最慢的几套(整局加速跑 / 经济 / 结局流程),保留"冒烟 + 科技 + 研究 + 本次新增"。
// 交付前仍要跑全量 —— 这条只是让"改一行看一眼"不用等 5 分钟。
const SKIP_QUICK = ['jsdom-05-economy.js', 'jsdom-06-endings.js', 'jsdom-10-fullrun.js'];

let files = fs.readdirSync(__dirname).filter((f) => /^jsdom-\d+.*\.js$/.test(f)).sort();
if (QUICK) files = files.filter((f) => SKIP_QUICK.indexOf(f) < 0);

const runOne = (f) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ f, code, out }));
});

(async function main() {
  const results = [];
  let i = 0;
  const workers = new Array(Math.min(CONCURRENCY, files.length)).fill(0).map(async () => {
    while (i < files.length) {
      const f = files[i++];
      results.push(await runOne(f));
    }
  });
  await Promise.all(workers);
  // 按文件名排序输出(并行跑完的顺序是乱的)
  results.sort((a, b) => (a.f < b.f ? -1 : 1));
  let bad = 0;
  for (const r of results) {
    const fails = r.out.split('\n').filter((l) => l.indexOf('✗') >= 0);
    const summary = (r.out.match(/结果[:：].*/) || [''])[0].trim();
    console.log('== ' + r.f + ' : ' + (r.code === 0 ? '通过' : '失败') + (summary ? '  ' + summary : ''));
    for (const l of fails) console.log('   ' + l.trim());
    if (r.code !== 0) bad++;
  }
  console.log(bad ? '\n✗ 有 ' + bad + ' 个套件失败' : '\n✓ 全部 jsdom 套件通过(共 ' + files.length + ' 个)');
  process.exit(bad ? 1 : 0);
})();
