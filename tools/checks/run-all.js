/* ============================================================
   tools/checks/run-all.js —— 一次跑完所有 jsdom 自测套件

   用法(在本目录):
     npm i jsdom        # 只需要一次
     node run-all.js            # 全量:11 套(交付前跑这个)
     node run-all.js --quick    # 快速:只跑关键几套(改代码时每轮跑它,约 1 分钟)

   每个套件都会自己开一个本地静态服务器、用 jsdom 真跑一遍 index.html,
   最后打印「通过 / 失败」与失败项。任一失败,退出码为 1。
   ============================================================ */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const QUICK = process.argv.indexOf('--quick') >= 0;
// --quick 跳过最慢的几套(整局加速跑 / 经济 / 结局流程),保留"冒烟 + 科技 + 研究 + 本次新增"。
// 交付前仍要跑全量 —— 这条只是让"改一行看一眼"不用等 5 分钟。
const SKIP_QUICK = ['jsdom-05-economy.js', 'jsdom-06-endings.js', 'jsdom-10-fullrun.js'];

let files = fs.readdirSync(__dirname).filter((f) => /^jsdom-\d+.*\.js$/.test(f)).sort();
if (QUICK) files = files.filter((f) => SKIP_QUICK.indexOf(f) < 0);
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = out.split('\n').filter((l) => l.indexOf('✗') >= 0);
  const summary = (out.match(/结果[:：].*/) || out.match(/结果:.*/) || [''])[0].trim();
  console.log('== ' + f + ' : ' + (r.status === 0 ? '通过' : '失败') + (summary ? '  ' + summary : ''));
  for (const l of fails) console.log('   ' + l.trim());
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n✗ 有 ' + bad + ' 个套件失败' : '\n✓ 全部 jsdom 套件通过(共 ' + files.length + ' 个)');
process.exit(bad ? 1 : 0);
