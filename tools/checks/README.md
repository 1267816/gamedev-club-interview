# tools/checks —— 开发自测脚本（**不是游戏的一部分**）

浏览器不加载这里的东西,`index.html` 也不需要它们。它们的作用是:**改完游戏之后,先用它们跑一遍,
再把结果交给用户去浏览器里确认**,免得把明显坏掉的东西递过去。

## jsdom 套件（11 个）

在本目录先装一次依赖:

```
npm i jsdom
```

然后:

```
node run-all.js            # 一次跑完(交付前跑这个)
node run-all.js --quick    # 快速档:跳过最慢的 3 套,约 50 秒(改代码时每轮跑它)
node jsdom-05-economy.js   # 也可以单独跑某一个
```

| 文件 | 覆盖什么 |
| --- | --- |
| `jsdom-01-boot-story.js` | 启动序列、引导、剧情触发、重复操作折叠、暖色遗物 |
| `jsdom-02-save-load.js` | 刷新续玩 / 关窗重开 / 旧存档兜底 |
| `jsdom-03-tech-view.js` | 科技树视图、解锁、命令面板、成就页、闲置提示 |
| `jsdom-04-ui-detail.js` | 筛选组合、键盘导航、大数缩写、坏档 / 残缺档 |
| `jsdom-05-economy.js` | 几何成本、能量、算力槽、数据、仓库上限、探测进度与剧情改挂、**复制助手保留量封顶(V0.2.8)** |
| `jsdom-06-endings.js` | 模块停用、复制助手保留量、结局二选一与「回到选择时刻」 |
| `jsdom-07-v014.js` | V0.1.4 的报告项:成就预读、读数面板、全角标点、折叠、前置行等 |
| `jsdom-08-v015.js` | V0.1.5 的报告项:效果文字尊重数据表、小数显示、解析器加速探测、类别问号恢复、账号级成就 |
| `jsdom-09-research.js` | V0.2.0:立项 → 研究 → 完成、一次只研究一项、探测门槛、研究提速、终端有新消息、存档续研 |
| `jsdom-10-fullrun.js` | **整局加速跑**:把 `Date.now` 换成 60 倍速时钟 + 自动玩家,20 秒跑完一局,验剧情不漏 / 不重复 / 顺序正确、14 项科技解锁、无 NaN |
| `jsdom-11-v024.js` | V0.2.4~V0.2.6:方案 B 数值口径、`/rep off` `/rep on`、**「作者的话」已删干净**、**结局长文(打完才弹结算画面)**、S19 长按加速、S20 闲置文案、S21 打字机分级、音频接口 |

## 音频素材

`assets/audio/` 里的**四个** wav(`key` / `notify` / `bgm` / `ending`)是**本仓库自己合成**的
(没有第三方素材,所以没有授权问题),
生成脚本在 `tools/audio/make-audio.py`,想改音色就改参数重跑:

```
python tools/audio/make-audio.py
```

## Chrome 套件（3 个）

需要本机装了 Chrome(默认 `C:\Program Files\Google\Chrome\Application\chrome.exe`,
可用环境变量 `CHROME` 覆盖)。它们用无头 Chrome 真跑一遍,顺便截图 + 收集控制台报错:

```
node chrome-03-tech-ending.js %TEMP%\shot.png
```

| 文件 | 覆盖什么 |
| --- | --- |
| `chrome-01-layout.js` | 封面 / 科技树 / 成就页,以及 1400×900、900×600、1100×520 三种窗口 |
| `chrome-02-midgame.js` | 中局读数面板 + 在科技树里建造 |
| `chrome-03-tech-ending.js` | 右侧读数面板、空格停用模块、75% 的结局按钮、结算面板是否居中 |

## 数值一致性

改过 `src/js/game-data.js` 里的任何数值之后,记得跑一次:

```
node ../check-parity.js
```

它会把游戏与 `tools/economy-sim.js`(文档里所有节奏结论的来源)的参数逐项比对,不一致就报错。
