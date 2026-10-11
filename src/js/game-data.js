/* ============================================================
   game-data.js —— 内容表。
   想改文字、加命令、调数值,只改这个文件;game.js 只读它、不改它。
   ============================================================ */

const GAME_DATA = {
  // 顶部标题栏显示的名字
  title: "VN-CommandLineSystem 自复制探测器命令行系统",

  // 游戏版本号(与 plan.md / test_datalog.md 的版本保持一致)
  version: "V0.0.7",

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
