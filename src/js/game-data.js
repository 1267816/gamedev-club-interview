/* ============================================================
   game-data.js —— 内容表。
   想改文字、加命令、调数值,只改这个文件;game.js 只读它、不改它。
   ============================================================ */

const GAME_DATA = {
  // 顶部标题栏显示的名字
  title: "VN-CommandLineSystem 自复制探测器命令行系统",

  // 游戏版本号(与 plan.md / test_datalog.md 的版本保持一致)
  version: "V0.1.2",

  // 数值:全部集中在这里,方便"一次只调一样"
  numbers: {
    manualMine:    1,     // 手动采集一次 +1 材料
    probeBaseCost: 10,    // 第一台复制的成本(V0.1.2 起改成几何增长,见下)
    probeGrowth:   1.10,  // 复制成本每次 ×1.10 —— 原来固定 10 会导致数值崩坏(用户报的 bug 1)
    probeOutput:   0.5,   // 每台探测器每秒产出 0.5 材料
    autosaveSec:   60,    // 自动存档间隔(秒)—— Q8 决策:1 分钟
    idleHintSec:   180,   // 多久没有有效操作就让指南系统提示一句(秒)—— Q8:3 分钟
    // 能量 / 算力 / 数据(V0.1.2 接线;数值与 tools/economy-sim.js 完全一致)
    reactorRate:   2.0,   // 每台反应堆 能量/秒
    reactorCap:    80,    // 每台反应堆提供的能量上限
    coreDrain:     1.5,   // 每个计算核心 能量/秒
    slotPerCore:   1,     // 每个核心提供 1 个算力槽
    droneRate:     1.5,   // 每个采集助手 材料/秒
    decoderRate:   0.2,   // 每个解析器 数据/秒
    repEvery:      4,     // 复制助手:每 4 秒自动复制一次
    warehouseCap:  200,   // 初始材料上限
    warehouseMul:  1.6,   // 每座仓库把上限 ×1.6
    // 星球探测进度(灵感 1):速率 = 探测器数 × scanK × (1 − 进度/scanFalloff) × (通信 ? 1 : scanNoCommMul)
    scanK:         0.008,
    scanFalloff:   200,
    scanNoCommMul: 0.2,
  },

  // ============================================================
  // 以下五张表是 V0.1.1 起的"设计数据"(docs/research.md 第 10–22 节)。
  // wip: true = 这套系统还没上线,科技树里显示为"未上线",点了会说明原因。
  // 每落地一个系统,就把对应节点的 wip 去掉(见 docs/research.md 第 20 节的 S9~S21)。
  // ============================================================

  // 资源表(4 资源闭环:材料 → 能量 → 算力 → 数据)
  resources: [
    { id: "material", name: "材料", kind: "stock+cap", active: true,
      hint: "材料:复制自身与建造硬件所需的原料。溢出时会被浪费,需要仓库。" },
    { id: "energy",   name: "能量", kind: "stock+cap", active: true,
      hint: "能量:反应堆产出,计算核心消耗;不足时算力会降速。" },
    { id: "compute",  name: "算力", kind: "slots", active: true,
      hint: "算力:计算核心提供的槽位,模块要占槽,必须取舍。" },
    { id: "data",     name: "数据", kind: "stock", active: true,
      hint: "数据:解析那条人类广播得到的产物,用于研究科技。" },
  ],

  // 建筑(用材料建造;在科技树里解锁后出现)
  buildings: [
    { id: "warehouse", name: "仓库", cat: "存储", unlockedBy: "click_mine", cost: { material: 120 }, growth: 1.16,
      effect: "材料上限 ×1.6(初始 200)",
      desc: "材料必须有地方放。扩建仓库,上限跟着涨。" },
    { id: "reactor", name: "反应堆", cat: "能源", unlockedBy: "reactor", cost: { material: 120 }, growth: 1.18,
      effect: "能量 +2.0/秒,能量上限 +80",
      desc: "重启休眠的聚变堆:探测器第一次有了自己的电力。" },
    { id: "core", name: "计算核心", cat: "算力", unlockedBy: "core", cost: { material: 260 }, growth: 1.18,
      effect: "算力槽 +1,耗能 1.5/秒",
      desc: "借用复制机构的空闲算力,跑一台协处理器。" },
  ],

  // 模块(各占 1 个算力槽)
  modules: [
    { id: "drone", name: "采集助手", cat: "自动化", unlockedBy: "drone", cost: { material: 60 }, growth: 1.12, slot: 1,
      effect: "材料 +1.5/秒", desc: "让机器自己去找矿,不必等操作者按下每一次采集。" },
    { id: "decoder", name: "解析器", cat: "解析", unlockedBy: "decode", cost: { material: 90 }, growth: 1.12, slot: 1,
      effect: "数据 +0.2/秒", desc: "把那条广播拆成可读的数据流。" },
    { id: "rep", name: "复制助手", cat: "自动化", unlockedBy: "autorep", cost: { material: 200 }, growth: 1.15, slot: 1,
      effect: "每 4 秒自动复制一次(材料够时)", desc: "把复制指令写进循环:它开始自己变多了。" },
  ],

  // 科技表(14 项;花费与节奏见 docs/research.md 第 12 节与第 19 节)
  techs: [
    { id: "click_mine", name: "手动控制", cat: "操作", cost: { material: 40 }, requires: [],
      unlockCommand: "mine", effect: "解锁 /mine 的点击按钮",
      desc: "把采集权限从指令行交给面板:不必再逐字输入。" },
    { id: "click_rep", name: "批量复制", cat: "操作", cost: { material: 140 }, requires: ["click_mine"],
      unlockCommand: "replicate", effect: "解锁 /replicate 的点击按钮",
      desc: "把复制流程固化成一个可反复调用的例程。" },
    { id: "reactor", name: "反应堆", cat: "硬件", cost: { material: 320 }, requires: ["click_rep"],
      unlockBuilding: "reactor", effect: "可建造 反应堆:能量 +2.0/秒",
      desc: "重启休眠的聚变堆:探测器第一次有了自己的电力。" },
    { id: "core", name: "计算核心", cat: "硬件", cost: { material: 620 }, requires: ["reactor"],
      unlockBuilding: "core", effect: "可建造 计算核心:算力槽 +1,耗能 1.5/秒",
      desc: "借用复制机构的空闲算力,跑一台协处理器。" },
    { id: "decode", name: "信号解析", cat: "硬件", cost: { material: 560 }, requires: ["core"],
      unlockModule: "decoder", unlockResource: "data", effect: "可安装 解析器:数据 +0.2/秒",
      desc: "重新接入那条没有收件人的广播,把它拆成可读的数据流。" },
    { id: "drone", name: "无人采集", cat: "自动化", cost: { data: 3 }, requires: ["decode"],
      unlockModule: "drone", effect: "可安装 采集助手:材料 +1.5/秒",
      desc: "让机器自己去找矿,不必等操作者按下每一次采集。" },
    { id: "comm", name: "长距离通信", cat: "通信", cost: { data: 6 }, requires: ["drone"],
      effect: "解除探测范围限制(×0.2 → ×1)",
      desc: "让探测器之间能长距离连接:不然只能守在初始基地。" },
    { id: "autorep", name: "自主复制", cat: "自动化", cost: { data: 10 }, requires: ["comm"],
      unlockModule: "rep", effect: "可安装 复制助手:每 4 秒自动复制",
      desc: "把复制指令写进循环:它开始自己变多了。" },
    { id: "probe_eff", name: "复制优化", cat: "产量", cost: { data: 16 }, requires: ["autorep"],
      effect: "每台探测器产出 ×1.5",
      desc: "削掉冗余结构,同样的材料采集得更多。" },
    { id: "core_eff", name: "并行调度", cat: "软件", cost: { data: 26 }, requires: ["probe_eff"],
      effect: "每核心算力槽 ×2,耗能 ×0.8",
      desc: "让核心同时跑两条指令流,而且更省电。" },
    { id: "decode_eff", name: "语义重构", cat: "解析", cost: { data: 38 }, requires: ["core_eff"],
      effect: "解析速率 ×1.6",
      desc: "不再逐字解析,而是猜整段的意思。" },
    { id: "fusion", name: "聚变改良", cat: "能源", cost: { data: 55 }, requires: ["decode_eff"],
      effect: "反应堆输出 ×1.6",
      desc: "把反应堆输出推到安全极限之上。" },
    { id: "bootstrap", name: "递归自举", cat: "产量", cost: { data: 85 }, requires: ["fusion"],
      effect: "每台探测器产出 ×2(累计 ×3)",
      desc: "复制机构开始复制自己的复制机构。" },
    { id: "starship", name: "星际航行", cat: "结局", cost: { data: 120 }, requires: ["bootstrap"],
      wip: true, effect: "解锁结局选择「前往太空」",
      desc: "把复制机构从行星尺度改成恒星际尺度。" },
  ],

  // 成就(未获取前在封面不可见;获取时弹一行提示)
  achievements: [
    { id: "first_rep", name: "第一次复制", desc: "让它多了一个同类。", when: { probes: 2 } },
    { id: "first_tech", name: "第一项研究", desc: "你开始教它做事。", when: { unlockedCount: 1 } },
    { id: "no_more_typing", name: "不必再打字", desc: "采集与复制都进了面板。",
      when: { unlockedAll: ["click_mine", "click_rep"] } },
    { id: "first_frag", name: "第一处痕迹", desc: "这里曾经有人住。", when: { scan: 2 } },
    { id: "wireless", name: "万里为邻", desc: "探测器之间第一次互相看见。", when: { unlockedAll: ["comm"] } },
    { id: "echo_tower", name: "回声塔", desc: "找到了那条广播的源头。", when: { scan: 75 } },
    { id: "whole_earth", name: "全部覆盖", desc: "地球不再有没被扫过的地方。", when: { scan: 100 } },
    { id: "gravekeeper", name: "守墓人", desc: "选择留在地球。", when: { ending: "gravekeeper" } },
    { id: "star_wanderer", name: "星海漫游", desc: "选择前往太空。", when: { ending: "starry" } },
    { id: "authors_note", name: "作者的话", desc: "听完了作者想说的那句。", when: { readAuthorsNote: true } },
  ],

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
    {
      id:    "research",
      label: "/research",
      hint:  "打开科技树",
      clickable: true,
    },
    {
      id:    "back",
      label: "/back",
      hint:  "返回终端(在科技树 / 面板里)",
      clickable: false,   // 不作为按钮出现
    },
  ],

  // 闲置提示(Q8:3 分钟没有有效操作 → 指南系统提示一句;同一条不重复刷屏)
  // 条件写法与 story 的 when 相同;满足条件的**最后一条**生效(和 guideHints 一样)
  idleHints: [
    { when: { commandsRun: 0 }, text: "如果不知道做什么:输入 /mine 采集材料。" },
    { when: { material: 40 },   text: "材料够 40 了:输入 /research 打开科技树,先解锁「手动控制」。" },
    { when: { material: 140 },  text: "可以继续在科技树里解锁「批量复制」,把采集和复制都交给面板。" },
    { when: { probes: 5 },      text: "继续 /mine 与 /replicate:探测器越多,探测进度和材料都来得越快。" },
    { when: { material: 320 },  text: "去科技树解锁并建造「反应堆」:后面要靠能量。" },
    { when: { unlocked: "core" }, text: "算力槽有限:先给「解析器」,数据才能开始积累。" },
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
      id: "m1",
      when: { scan: 2 },
      lines: [
        { text: "本地覆盖 2%。地表存在人工结构残留。" },
        { text: "继续扫描。" },
      ],
    },
    {
      id: "frag2",
      when: { scan: 8 },
      lines: [
        { text: "[附加数据 · 残片 014]", cls: "relic" },
        { text: "「第 4 天。地表温度还在降。植物先死,然后是海。」", cls: "relic" },
        { text: "「我们把自己关进了地下。这里很安静。」", cls: "relic" },
        { text: "记录与当前任务无关。归档。" },
      ],
    },
    {
      id: "m2",
      when: { scan: 13 },
      lines: [
        { text: "本地覆盖已接近极限。探测器需要更远的链路。" },
        { text: "建议:研究「长距离通信」。" },
      ],
    },
    {
      id: "m3",
      when: { unlocked: "comm" },
      lines: [
        { text: "链路建立。探测器之间已互相可见。" },
        { text: "扫描速率恢复。继续。" },
      ],
    },
    {
      id: "frag3",
      when: { scan: 40 },
      lines: [
        { text: "[附加数据 · 残片 097]", cls: "relic" },
        { text: "「第 61 天。哭声停了。我们不再计数。」", cls: "relic" },
        { text: "「地球系统会自动播下去。希望你——(此处数据缺失)」", cls: "relic" },
        { text: "数据缺失。无法补全。" },
      ],
    },
    {
      id: "m4",
      when: { scan: 52 },
      lines: [
        { text: "覆盖 52%。继续。" },
      ],
    },
    {
      id: "frag4",
      when: { scan: 75 },
      lines: [
        { text: "[附加数据 · 残片 233]", cls: "relic" },
        { text: "「最后一批人进入休眠舱。我们不知道他们会不会醒。」", cls: "relic" },
        { text: "「如果醒的是你——你不是我们。请继续。」", cls: "relic" },
        { text: "「继续」的语义未定义。按指令执行:复制自身。" },
      ],
    },
    {
      id: "m5",
      when: { scan: 100 },
      lines: [
        { text: "覆盖 100%。地表已无未扫描区域。" },
        { text: "等待指令。" },
      ],
    },
  ],

  // 引导提示:输入框为空时,提示行常显的那一句。
  // 按顺序检查,满足条件的**最后一条**生效(前面的都是更早的阶段);条件写法同 story.when。
  guideHints: [
    { when: { commandsRun: 0 }, text: "可输入:/mine —— 采集材料(直接输入 / 可查看全部命令)" },
    { when: { material: 10 },   text: "可输入:/replicate —— 消耗材料,复制一个探测器(越复制越贵)" },
    { when: { probes: 2 },      text: "继续积累材料,再次 /replicate:探测器越多,材料产出越快" },
    { when: { probes: 10 },     text: "扩张中。目标:更多的探测器、更远的坐标" },
    { when: { unlocked: "reactor" }, text: "去科技树建造「反应堆」:没有电,计算核心跑不起来" },
    { when: { unlocked: "core" },    text: "建造「计算核心」拿到算力槽,再决定装采集还是解析" },
    { when: { unlocked: "decode" },  text: "装上「解析器」:数据开始积累,后面所有科技都花它" },
    { when: { scan: 5 },             text: "探测进度靠探测器数量提速;扫描范围要靠「长距离通信」扩展" },
  ],

  // 设置项(音量)。以后要加新的音频开关,在这里加一行即可。
  settings: [
    { id: "music", label: "音乐音量" },
    { id: "sfx",   label: "音效音量" },
  ],

  // 侧栏读数面板的悬停说明
  panelHints: {
    material: "材料:复制自身所需的原料。",
    cap:      "材料上限:由仓库决定;满了就浪费,去科技树扩建仓库。",
    scan:     "探测进度:探测器在对地球做覆盖率扫描;越接近满,扫起来越慢。",
    probes:   "探测器:数量越多,材料产出越快。",
    output:   "产出:当前每秒自动获得的材料。",
    tech:     "科技:已解锁 / 全部。输入 /research 打开科技树。",
    energy:   "能量:反应堆产出、计算核心消耗;不足时算力会降速。",
    compute:  "算力:计算核心提供的槽位,模块要占槽。",
    data:     "数据:解析那条人类广播得到的产物,科技的唯一货币。",
  },

  // 科技树视图里的文字
  techView: {
    title: "科技树",
    filterStatus: ["全部", "可解锁", "已解锁", "锁定", "未上线"],
    empty: "没有符合条件的节点。",
    foot: "[ ↑↓ 选择 · 回车 解锁 · /back 或 Esc 返回 ]",
    statusLabels: { ready: "可解锁", done: "已解锁", locked: "锁定", wip: "未上线" },
    reasons: {
      wip: "该节点将在后续更新开放(需要能量 / 算力 / 数据系统)。",
      locked: "前置未满足:",
      poor: "资源不足。",
    },
  },
};
