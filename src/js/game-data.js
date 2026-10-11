/* ============================================================
   game-data.js —— 内容表。
   想改文字、加命令、调数值,只改这个文件;game.js 只读它、不改它。
   ============================================================ */

const GAME_DATA = {
  // 顶部标题栏显示的名字
  title: "VN-CommandLineSystem 自复制探测器命令行系统",

  // 游戏版本号(与 plan.md / test_datalog.md 的版本保持一致)
  version: "V0.1.0",

  // 数值:全部集中在这里,方便"一次只调一样"
  numbers: {
    manualMine:    1,     // 手动采集一次 +1 材料
    replicateCost: 10,    // 复制一个探测器需要 10 材料(占位值,固定成本)
    probeOutput:   0.5,   // 每台探测器每秒产出 0.5 材料
  },

  // 开局一行行打印的启动日志。
  // revealAll: true 的那一行是转折点——在它打印完成之前,此前所有内容(日志、
  // 顶栏、侧栏)都显示为等长的问号;它一出现,这些问号一次性还原成真实文字。
  bootLog: [
    { text: "接收到特定信号" },
    { text: "VN-01 自复制探测器 启动自检" },
    { text: "应急固件已上线" },
    { text: "指南系统已上线" },
    { text: "字符解析系统已上线", revealAll: true },
    { text: "控制系统已上线" },
    { text: "  反应堆       [ OK ]" },
    { text: "  复制机构     [ OK ]" },
    { text: "  指令集       [ 1 条 ]" },
    { text: "指令:复制自身。" },
    { text: "……没有别的指令了。" },
    { text: "等待输入。" },
  ],

  // 玩家可点击执行的命令
  commands: [
    {
      id:    "mine",
      label: "/mine",
      hint:  "采集材料 +1",
      group: "mine",          // 连续的同名操作会折叠成一条并计数
      clickable: false,       // 点击功能以后由科技树解锁
    },
    {
      id:           "replicate",
      label:        "/replicate",
      hint:         "消耗 10 材料,复制一个探测器",
      costMaterial: 10,
      group:        "replicate",
      clickable:    false,    // 点击功能以后由科技树解锁
    },
    {
      id:    "save",
      label: "/save",
      hint:  "保存当前进度",
      clickable: true,
    },
    {
      id:    "exit",
      label: "/exit",
      hint:  "返回封面(会先自动保存)",
      clickable: true,
    },
  ],

  // 剧情 / 引导:一串"节点",按表内顺序检查,条件满足就打出来。
  // 每条节点:{ id, when, lines, important? }
  //   when 里可用的键(写了几个就要同时满足几个):
  //     onBoot      启动序列打完后立刻触发
  //     after       先触发了另一个节点的 id
  //     commandsRun 已执行命令数 >=
  //     material    材料 >=
  //     probes      探测器 >=
  //     timeSec     游戏内秒数 >=
  //   lines 里每条:{ text, cls? };cls: "relic" = 人类遗物(暖色),不写 = 机器日志(冷色)。
  //   触发过的节点会记进 game.fired,不会重复触发;默认计入"重要信息"(可被「以前的信息」展开)。
  story: [

    // ---------- P1 新手引导:告诉玩家"该输入什么" ----------
    {
      id: "p1",
      when: { onBoot: true },
      lines: [
        { text: "检测到操作者。" },
        { text: "指令集有限。所有指令以 / 开头。" },
        { text: "建议输入:/mine —— 采集材料。" },
      ],
    },
    {
      id: "p1b",
      when: { material: 3 },
      lines: [
        { text: "材料累积到 10 后,可执行 /replicate 复制自身。" },
      ],
    },

    // ---------- P2 第一次复制之后:混进来的那段"附加数据" ----------
    {
      id: "p2",
      when: { probes: 2 },
      lines: [
        { text: "……" },
        { text: "侦测到一段附加数据。来源标记已损坏。" },
        { text: "试图解析。失败。" },
        { text: "再次试图解析。" },
      ],
    },

    // ---------- P3 附加数据 · 残片 001:人类遗物的第一段("热"的那一面) ----------
    {
      id: "p3",
      when: { after: "p2" },
      lines: [
        { text: "[附加数据 · 残片 001]", cls: "relic" },
        { text: "「……如果你读到这里,说明广播已经发出去了。」", cls: "relic" },
        { text: "「我们等不到回信了。这不是求救——发信的人已经不在了。」", cls: "relic" },
        { text: "「把我们的全部,交给任何一个愿意继续活下去的东西。」", cls: "relic" },
      ],
    },
    {
      id: "p4",
      when: { after: "p3" },
      lines: [
        { text: "解析结果:一份遗嘱,附带种子数据。" },
        { text: "与核心指令不冲突。继续执行:复制自身。" },
      ],
    },

    // ---------- 中段:自我复制在加速(机器视角的一句冷日志) ----------
    {
      id: "g1",
      when: { probes: 4 },
      lines: [
        { text: "复制速率上升。产出随探测器数量增长。" },
      ],
    },

    // ---------- 里程碑:地球旧日志不断浮出(越强,读到的越多) ----------
    {
      id: "frag2",
      when: { probes: 10 },
      lines: [
        { text: "[附加数据 · 残片 014]", cls: "relic" },
        { text: "「第 4 天。地表温度还在降。植物先死,然后是海。」", cls: "relic" },
        { text: "「我们把自己关进了地下。这里很安静。」", cls: "relic" },
        { text: "记录与当前任务无关。归档。" },
      ],
    },
    {
      id: "frag3",
      when: { probes: 25 },
      lines: [
        { text: "[附加数据 · 残片 097]", cls: "relic" },
        { text: "「第 61 天。哭声停了。我们不再计数。」", cls: "relic" },
        { text: "「地球系统会自动播下去。希望你——(此处数据缺失)」", cls: "relic" },
        { text: "数据缺失。无法补全。" },
      ],
    },
    {
      id: "frag4",
      when: { probes: 50 },
      lines: [
        { text: "[附加数据 · 残片 233]", cls: "relic" },
        { text: "「最后一批人进入休眠舱。我们不知道他们会不会醒。」", cls: "relic" },
        { text: "「如果醒的是你——你不是我们。请继续。」", cls: "relic" },
        { text: "「继续」的语义未定义。按指令执行:复制自身。" },
      ],
    },
  ],

  // 引导提示:输入框为空时,提示行常显的那一句。
  // 按顺序检查,满足条件的**最后一条**生效(前面的都是更早的阶段);条件写法同 story.when。
  guideHints: [
    { when: { commandsRun: 0 }, text: "可输入:/mine —— 采集材料(直接输入 / 可查看全部命令)" },
    { when: { material: 10 },   text: "可输入:/replicate —— 消耗 10 材料,复制一个探测器" },
    { when: { probes: 2 },      text: "继续积累材料,再次 /replicate:探测器越多,材料产出越快" },
    { when: { probes: 10 },     text: "扩张中。目标:更多的探测器、更远的坐标" },
  ],

  // 设置项(音量)。以后要加新的音频开关,在这里加一行即可。
  settings: [
    { id: "music", label: "音乐音量" },
    { id: "sfx",   label: "音效音量" },
  ],

  // 侧栏读数面板的悬停说明
  panelHints: {
    material: "材料:复制自身所需的原料。",
    progress: "进度条:距离下一次复制还差多少材料。",
    probes:   "探测器:数量越多,材料产出越快。",
    output:   "产出:当前每秒自动获得的材料。",
  },
};
