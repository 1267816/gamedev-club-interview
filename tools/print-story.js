/* tools/print-story.js —— 把"玩家能看到的全部剧情"按游戏检查的顺序打印出来。
   只读源码,不改游戏;游戏本体不加载这个文件。

   用法:
     node tools/print-story.js              # 打到控制台
     node tools/print-story.js > 剧本.md     # 存成文件(PowerShell 下用 > 也行)

   为什么要有它:文案改过很多轮,靠记忆复述容易出错 —— 这份导出永远等于代码里的实际内容。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const data = eval(fs.readFileSync(path.join(ROOT, 'src', 'js', 'game-data.js'), 'utf8') + '\n;GAME_DATA');

const gameSrc = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game.js'), 'utf8');
const start = gameSrc.indexOf('const ENDINGS = {');
const endSrc = gameSrc.slice(start, gameSrc.indexOf('\n};', start) + 3);
const ENDINGS = eval(endSrc + ';ENDINGS');

const W = (s) => console.log(s === undefined ? '' : s);

// when → 人话
function whenText(w) {
  if (!w) return '(无条件)';
  const p = [];
  if (w.onBoot) p.push('启动序列结束后立刻');
  if (w.after) p.push('在 ' + w.after + ' 之后');
  if (w.probes != null) p.push('探测器 ≥ ' + w.probes);
  if (w.material != null) p.push('材料 ≥ ' + w.material);
  if (w.scan != null) p.push('探测 ≥ ' + w.scan + '%');
  if (w.unlocked) p.push('解锁「' + w.unlocked + '」后');
  if (w.unlockedAll) p.push('解锁 ' + w.unlockedAll.join(' + ') + ' 后');
  if (w.commandsRun != null) p.push('执行过 ' + w.commandsRun + ' 条命令后');
  if (w.timeSec != null) p.push('游戏内 ' + w.timeSec + ' 秒后');
  if (w.researching != null) p.push(w.researching ? '正在研究时' : '不在研究时');
  if (w.module != null) p.push('装过「' + w.module + '」');
  return p.join(' 且 ') || '(无条件)';
}

function lineOf(l) {
  const t = typeof l === 'string' ? l : l.text;
  const cls = typeof l === 'string' ? '' : (l.cls || '');
  if (t === '') return '   ｜(空行,分段用)';
  if (cls === 'relic') return '   ｜【暖色·人类侧】' + t;
  if (cls) return '   ｜[' + cls + '] ' + t;
  return '   ｜【冷色·机器侧】' + t;
}

W('# 玩家能看到的全部剧情（' + data.version + '）');
W('');
W('> 由 `node tools/print-story.js` 从 `src/js/game-data.js` 与 `src/js/game.js` 直接导出，');
W('> 顺序 = 游戏里 `story` 表的检查顺序（同一条命令里满足多个条件时，也是按这个顺序打）。');
W('> 「暖色」= 人类侧文本（琥珀色、打字更慢）；「冷色」= 机器日志。');
W('');
W('## 0. 启动序列（`bootLog`，每 320 毫秒打一行）');
W('');
for (const e of data.bootLog) {
  W('- ' + e.text + (e.revealAll ? '   ← **这一行出现时，前面的乱码一次性还原成文字**' : ''));
}
W('');
W('## 1. 剧情节点（' + data.story.length + ' 个，按表内顺序）');
for (const n of data.story) {
  W('');
  W('### `' + n.id + '`　触发：' + whenText(n.when));
  for (const l of n.lines) W(lineOf(l));
}
W('');
W('## 2. 两个结局（`ENDINGS`，选完之后打，打完再停 3.5 秒弹结算画面）');
for (const k of Object.keys(ENDINGS)) {
  const e = ENDINGS[k];
  W('');
  W('### ' + k + '　结局名：' + e.name + '　（成就：' + e.ach + '）');
  for (const l of e.lines) W(lineOf(l));
  W('   ｜结算画面说明：' + e.note);
}

// —— 附录:不是剧情,但玩家会在终端里看到的提示 ——
W('');
W('## 附录 A. 引导提示（输入框为空时常显的那一行，取满足条件的最后一条）');
for (const g of data.guideHints) W('- （' + whenText(g.when) + '）' + g.text);
W('');
W('## 附录 B. 闲置提示（3 分钟没操作时由"指南系统"说一句）');
for (const h of data.idleHints) W('- （' + whenText(h.when) + '）' + h.text);
