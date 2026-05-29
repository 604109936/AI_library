import type {
  Book,
  Category,
  Chapter,
  Review,
  NoteItem,
  ChatSession,
  HistoryItem,
  UserProfile,
} from "@/lib/types";

export const categories: Category[] = [
  { id: "psy", name: "心理学", count: 48, icon: "Brain" },
  { id: "biz", name: "商业", count: 36, icon: "TrendingUp" },
  { id: "lit", name: "文学", count: 52, icon: "Feather" },
  { id: "his", name: "历史", count: 33, icon: "Landmark" },
  { id: "tech", name: "科技", count: 29, icon: "Cpu" },
  { id: "growth", name: "自我成长", count: 45, icon: "Sprout" },
];

interface RawBook {
  id: string;
  title: string;
  author: string;
  categoryId: string;
  tags: string[];
  summary: string;
  lead: string; // 第一章开篇 / 引用摘录来源（有质感的一句话）
  rating: number;
  readers: number;
  words: number;
  modes: ("video" | "audio" | "text")[];
  featured?: boolean;
  intro: string;
  chapterTitles: string[];
}

const raw: RawBook[] = [
  {
    id: "mindset",
    title: "终身成长",
    author: "卡罗尔·德韦克",
    categoryId: "psy",
    tags: ["成长思维", "心理学", "自我提升"],
    summary:
      "斯坦福大学心理学教授卡罗尔·德韦克提出，决定人生走向的并非天赋，而是思维模式。固定型思维让人逃避挑战，成长型思维让人在困难中精进。",
    lead: "我们对自己能力的看法，悄悄决定了我们会成为什么样的人——这便是思维模式的力量。",
    rating: 4.6,
    readers: 1286000,
    words: 167000,
    modes: ["video", "audio", "text"],
    featured: true,
    intro: "重新定义成功的思维模式",
    chapterTitles: [
      "思维模式的力量",
      "思维模式解析",
      "关于能力和成就的真相",
      "成长型思维的应用",
      "改变思维模式",
    ],
  },
  {
    id: "cipoetry",
    title: "人间词话",
    author: "王国维",
    categoryId: "lit",
    tags: ["古典文学", "美学", "诗词"],
    summary:
      "王国维以“境界说”重新评点中国古典词作，融汇中西美学，是近代以来最具影响力的词学批评著作。",
    lead: "词以境界为最上。有境界则自成高格，自有名句——五代北宋之词所以独绝者在此。",
    rating: 4.8,
    readers: 543000,
    words: 62000,
    modes: ["audio", "text"],
    featured: true,
    intro: "有境界则自成高格",
    chapterTitles: ["境界说", "词论选读", "古今之成大事业者", "词人品评", "余论"],
  },
  {
    id: "courage",
    title: "被讨厌的勇气",
    author: "岸见一郎·古贺史健",
    categoryId: "psy",
    tags: ["阿德勒", "人际关系", "勇气"],
    summary:
      "以哲人与青年对话的形式，讲述阿德勒心理学：一切烦恼都源于人际关系，真正的自由是被讨厌的勇气。",
    lead: "如果你能够不在意别人的评价、不害怕被别人讨厌，那么你的人生将会变得简单而辽阔。",
    rating: 4.5,
    readers: 982000,
    words: 138000,
    modes: ["video", "audio", "text"],
    intro: "自由就是不再寻求认可",
    chapterTitles: ["我们的不幸是谁的错", "一切烦恼都来自人际关系", "让干涉你生活的人见鬼去", "要有被讨厌的勇气", "认真的人生活在当下"],
  },
  {
    id: "intimacy",
    title: "亲密关系",
    author: "罗兰·米勒",
    categoryId: "psy",
    tags: ["亲密关系", "社会心理", "情感"],
    summary:
      "深入探讨亲密关系的本质与规律，从吸引、沟通到冲突与维系，用科学视角理解人与人之间的情感联结。",
    lead: "我们都渴望被另一个人深深理解，而亲密，正是在彼此的脆弱里慢慢生长出来的信任。",
    rating: 4.4,
    readers: 671000,
    words: 210000,
    modes: ["text"],
    intro: "理解爱，才能更好地去爱",
    chapterTitles: ["人际关系的构成", "吸引力", "沟通", "相互依赖", "冲突与修复"],
  },
  {
    id: "deepwork",
    title: "深度工作",
    author: "卡尔·纽波特",
    categoryId: "biz",
    tags: ["专注", "效率", "职业"],
    summary:
      "在分心成瘾的时代，深度工作的能力日益稀缺而宝贵。本书给出系统方法，帮助你培养高度专注、创造真正价值。",
    lead: "深度工作，是在无干扰的状态下专注进行的职业活动——它能把你的认知能力推向极限。",
    rating: 4.3,
    readers: 758000,
    words: 156000,
    modes: ["video", "text"],
    intro: "专注是这个时代最稀缺的能力",
    chapterTitles: ["深度工作是有价值的", "深度工作是少见的", "深度工作是有意义的", "工作要深入", "远离社交媒体"],
  },
  {
    id: "willpower",
    title: "自控力",
    author: "凯利·麦格尼格尔",
    categoryId: "psy",
    tags: ["自控", "习惯", "意志力"],
    summary:
      "斯坦福大学广受欢迎的意志力课程，揭示自控力的科学原理，教你像锻炼肌肉一样训练意志力。",
    lead: "意志力不是一种美德，而是一种可以被理解、被训练的生理本能，它像肌肉一样会疲劳，也会变强。",
    rating: 4.2,
    readers: 689000,
    words: 142000,
    modes: ["audio", "text"],
    intro: "意志力是可以训练的肌肉",
    chapterTitles: ["我要做、我不要、我想要", "意志力的本能", "为什么自控力如此重要", "容忍罪恶", "大脑的弥天大谎"],
  },
  {
    id: "practice",
    title: "刻意练习",
    author: "安德斯·艾利克森",
    categoryId: "growth",
    tags: ["刻意练习", "技能", "成长"],
    summary:
      "杰出并非天赋，而是正确练习的结果。本书提出“刻意练习”法则，揭示从新手到大师的科学路径。",
    lead: "天才不是天生的。区分卓越与平庸的，不是与生俱来的天赋，而是有目的、有方法的刻意练习。",
    rating: 4.4,
    readers: 812000,
    words: 178000,
    modes: ["video", "audio", "text"],
    featured: true,
    intro: "天才，是练出来的",
    chapterTitles: ["有目的的练习", "大脑的适应能力", "心理表征", "黄金标准", "成为杰出人物"],
  },
  {
    id: "awakening",
    title: "认知觉醒",
    author: "周岭",
    categoryId: "growth",
    tags: ["认知", "自我管理", "成长"],
    summary:
      "从脑科学与认知规律出发，讲清楚为什么我们焦虑、拖延，又如何通过认知升级开启自我改变的内在动力。",
    lead: "焦虑的根源，往往是想同时做很多事，又想立即看到结果——而成长本就是一件需要耐心的事。",
    rating: 4.3,
    readers: 934000,
    words: 165000,
    modes: ["text"],
    intro: "开启自我改变的原动力",
    chapterTitles: ["大脑——重新认识你自己", "潜意识——生命留给我们的彩蛋", "元认知——人类的终极能力", "专注力", "学习力"],
  },
  {
    id: "china",
    title: "置身事内",
    author: "兰小欢",
    categoryId: "biz",
    tags: ["经济", "政府", "发展"],
    summary:
      "以政府与经济发展为线索，深入浅出地讲清中国经济运行的内在逻辑，是理解当代中国的一把钥匙。",
    lead: "理解中国经济，要先理解地方政府——它既是裁判员，也是这场发展竞赛里最活跃的运动员。",
    rating: 4.7,
    readers: 1024000,
    words: 198000,
    modes: ["video", "text"],
    featured: true,
    intro: "中国政府与经济发展",
    chapterTitles: ["地方政府的权力与事务", "财税与政府行为", "政府投融资与债务", "工业化中的政府角色", "城市化与不平衡"],
  },
  {
    id: "guns",
    title: "枪炮、病菌与钢铁",
    author: "贾雷德·戴蒙德",
    categoryId: "his",
    tags: ["人类史", "地理", "文明"],
    summary:
      "为什么是欧亚大陆的人征服了世界？戴蒙德从地理与生态出发，重构了人类社会一万三千年的宏大演化史。",
    lead: "不同民族的命运之所以如此不同，并非因为天赋的差异，而是源于他们所处环境的差异。",
    rating: 4.5,
    readers: 587000,
    words: 256000,
    modes: ["audio", "text"],
    intro: "人类社会的命运",
    chapterTitles: ["人类社会的起跑线", "粮食生产的扩散", "病菌的礼物", "文字的演化", "地理决定论"],
  },
  {
    id: "tobelive",
    title: "活着",
    author: "余华",
    categoryId: "lit",
    tags: ["当代文学", "命运", "苦难"],
    summary:
      "讲述农民福贵历尽世间沧桑与磨难的一生，以朴素而有力的笔触，写尽中国人面对苦难时的坚韧与温情。",
    lead: "人是为了活着本身而活着，而不是为了活着之外的任何事物而活着。",
    rating: 4.9,
    readers: 1563000,
    words: 124000,
    modes: ["audio", "text"],
    featured: true,
    intro: "为了活着本身而活着",
    chapterTitles: ["少年游荡", "家道中落", "战乱与归来", "亲人相继", "老人与牛"],
  },
  {
    id: "fortress",
    title: "围城",
    author: "钱钟书",
    categoryId: "lit",
    tags: ["现代文学", "讽刺", "婚姻"],
    summary:
      "以方鸿渐的留学归来与婚恋际遇为线索，以机智幽默的笔调，写尽知识分子的虚荣、彷徨与人生的“围城”困境。",
    lead: "围在城里的人想逃出来，城外的人想冲进去；婚姻也罢，事业也罢，人生的愿望大都如此。",
    rating: 4.7,
    readers: 876000,
    words: 198000,
    modes: ["text"],
    intro: "城里城外，皆是人生",
    chapterTitles: ["归国之船", "故乡与家", "三闾大学", "围城之内", "散场"],
  },
  {
    id: "sapiens",
    title: "人类简史",
    author: "尤瓦尔·赫拉利",
    categoryId: "his",
    tags: ["人类史", "认知革命", "文明"],
    summary:
      "从认知革命、农业革命到科学革命，赫拉利以宏阔视野重述智人如何从一种普通动物，成为地球的主宰。",
    lead: "智人之所以能统治世界，是因为我们能凭借想象，让成千上万互不相识的人为同一个故事而协作。",
    rating: 4.7,
    readers: 1342000,
    words: 232000,
    modes: ["video", "audio", "text"],
    featured: true,
    intro: "从动物到上帝",
    chapterTitles: ["认知革命", "农业革命", "人类的融合统一", "科学革命", "智人的终结"],
  },
  {
    id: "wanli",
    title: "万历十五年",
    author: "黄仁宇",
    categoryId: "his",
    tags: ["明史", "大历史观", "制度"],
    summary:
      "以平淡的1587年为切口，黄仁宇用“大历史观”剖开一个庞大帝国的肌理，看似无事之年，正是王朝积弊的缩影。",
    lead: "公元1587年，表面上四海升平、无事可记，实际上却是大明王朝走向衰落的一个关键转折。",
    rating: 4.6,
    readers: 712000,
    words: 176000,
    modes: ["audio", "text"],
    intro: "一个无关紧要年份的大历史",
    chapterTitles: ["万历皇帝", "首辅申时行", "世间已无张居正", "活着的祖宗", "海瑞与戚继光"],
  },
  {
    id: "outofcontrol",
    title: "失控",
    author: "凯文·凯利",
    categoryId: "tech",
    tags: ["复杂系统", "互联网", "预言"],
    summary:
      "凯文·凯利在三十年前便预见了云计算、群体智能与去中心化，本书是理解互联网与未来技术演化的思想源头。",
    lead: "最复杂、最有生命力的系统，往往不是被设计出来的，而是从底层简单规则中自下而上涌现出来的。",
    rating: 4.4,
    readers: 498000,
    words: 388000,
    modes: ["text"],
    intro: "全人类的最终命运和结局",
    chapterTitles: ["人造与天生", "蜂群思维", "有机体的进化", "失控的未来", "网络经济学"],
  },
  {
    id: "mathbeauty",
    title: "数学之美",
    author: "吴军",
    categoryId: "tech",
    tags: ["算法", "人工智能", "通识"],
    summary:
      "吴军用通俗的语言，揭示搜索引擎、语音识别、机器翻译背后的数学原理，让人领略简单数学之中的强大与优雅。",
    lead: "好的方法在形式上往往是简单而优美的——真正的高手，追求的是用最朴素的数学解决最复杂的问题。",
    rating: 4.6,
    readers: 623000,
    words: 168000,
    modes: ["audio", "text"],
    intro: "简单之中，自有大美",
    chapterTitles: ["文字与语言", "统计语言模型", "隐含马尔可夫模型", "信息的度量", "搜索引擎的原理"],
  },
  {
    id: "homodeus",
    title: "未来简史",
    author: "尤瓦尔·赫拉利",
    categoryId: "tech",
    tags: ["未来", "人工智能", "数据主义"],
    summary:
      "在战胜饥荒、瘟疫与战争之后，人类把目光投向永生、幸福与神性。赫拉利追问：当算法比你更懂你，人将走向何方？",
    lead: "当外部的算法比你自己更了解你的渴望时，权威便会从个人手中，悄悄转移到数据之中。",
    rating: 4.5,
    readers: 934000,
    words: 214000,
    modes: ["video", "text"],
    intro: "从智人到智神",
    chapterTitles: ["人类的新议题", "人类世", "人文主义革命", "智人失去控制权", "数据主义"],
  },
  {
    id: "principles",
    title: "原则",
    author: "瑞·达利欧",
    categoryId: "biz",
    tags: ["决策", "管理", "投资"],
    summary:
      "桥水基金创始人达利欧把人生与工作中反复验证的原则系统化，告诉你如何用极度求真与极度透明做出更好的决策。",
    lead: "痛苦加上反思，等于进步。把每一次挫折都当作一道可以解开的题，你就能不断进化。",
    rating: 4.4,
    readers: 845000,
    words: 246000,
    modes: ["video", "audio", "text"],
    intro: "生活、工作与决策的原则",
    chapterTitles: ["我的历程", "拥抱现实", "用五步流程实现愿望", "极度求真", "理解人与人不同"],
  },
  {
    id: "flow",
    title: "心流",
    author: "米哈里·契克森米哈赖",
    categoryId: "growth",
    tags: ["专注", "幸福", "积极心理"],
    summary:
      "当你全神贯注、忘记时间，便进入了“心流”。本书揭示这种最优体验的规律，告诉你如何在日常中创造幸福。",
    lead: "最好的时刻，往往出现在一个人为了某个艰难而有价值的目标，自愿把身心潜能发挥到极致的时候。",
    rating: 4.5,
    readers: 567000,
    words: 188000,
    modes: ["audio", "text"],
    intro: "最优体验的心理学",
    chapterTitles: ["心流的概念", "意识的解析", "心流的构成要素", "工作中的心流", "孤独中的心流"],
  },
];

const SECS_PER_CHAPTER = 90; // mock：每章在整书音频里的起始锚点（用于切章 seek）

const para = (book: RawBook, ch: string, idx: number) =>
  [
    idx === 0
      ? `${book.lead}`
      : `${ch}。在《${book.title}》的这一章里，${book.author}围绕“${ch}”层层展开，以清晰的逻辑与丰富的案例，引导我们重新审视那些习以为常的观念。`,
    `真正决定一个人能走多远的，并非起点的高低，而是他如何理解失败、如何对待挑战。当一个人愿意把困难视为可以练习的环节，心智便不再被一时的挫折束缚。`,
    `${book.summary}`,
    `相反，若把天赋当作唯一的尺度，每一次失败都会成为沉重的负担。本章提醒我们：成长是一个渐进而持续的过程，关键在于找到适合自己的方法并长久地坚持。`,
    `当我们把这一原则应用到日常的学习与工作中，便会发现，改变正在悄然发生——它改变了我们面对世界的姿态，也改变了未来展开的方向。`,
  ].join("\n\n");

// 视频/音频：保留稳定可达的示例源（国内可访问），靠 posterUrl 做差异化首帧；
// 真实的章节级视频/音频在后端阶段由七牛云提供。
const SAMPLE_VIDEO = "https://www.w3schools.com/html/mov_bbb.mp4";
const SAMPLE_AUDIO = "https://www.w3schools.com/html/horse.mp3";

export const books: Book[] = raw.map((b, i) => ({
  id: b.id,
  title: b.title,
  author: b.author,
  cover: `/covers/${b.id}.png`,
  coverSeed: i + 1,
  heroUrl: `/heroes/${b.categoryId}.png`,
  posterUrl: `/posters/${b.categoryId}.png`,
  category: categories.find((c) => c.id === b.categoryId)!.name,
  categoryId: b.categoryId,
  tags: b.tags,
  summary: b.summary,
  rating: b.rating,
  readers: b.readers,
  words: b.words,
  durationMin: Math.round(b.words / 550),
  hasVideo: b.modes.includes("video"),
  hasAudio: b.modes.includes("audio"),
  hasText: b.modes.includes("text"),
  videoUrl: b.modes.includes("video") ? SAMPLE_VIDEO : undefined,
  audioUrl: b.modes.includes("audio") ? SAMPLE_AUDIO : undefined,
  likes: Math.round(b.readers * 0.19),
  favCount: Math.round(b.readers * 0.075),
  reviewCount: Math.round(b.readers * 0.012),
  featured: !!b.featured,
  intro: b.intro,
}));

export const chaptersByBook: Record<string, Chapter[]> = Object.fromEntries(
  raw.map((b) => [
    b.id,
    b.chapterTitles.map((t, idx) => ({
      id: `${b.id}-c${idx + 1}`,
      bookId: b.id,
      no: idx + 1,
      title: t,
      content: para(b, t, idx),
      status: idx === 0 ? "reading" : idx === 1 ? "read" : "unread",
      audioStart: idx * SECS_PER_CHAPTER,
    })),
  ])
);

// 多套书评种子，按书轮换，避免每本书评价雷同
const reviewSets = [
  [
    { nickname: "松窗夜读", rating: 5, title: "纸上有清气", content: "行云流畅，娓娓道来。人物心绪层层铺开，读来余味悠长，是近来难得的好书。", likes: 128 },
    { nickname: "山月", rating: 4, title: "克制而温润", content: "语言干净，几处描写恰到好处，留三分余地给读者想象，反而更有力量。", likes: 96 },
    { nickname: "听雨书生", rating: 5, title: "值得慢慢读", content: "节奏舒缓，合上书的那一刻仍念念不忘，把它放在床头，时不时翻一翻。", likes: 73 },
    { nickname: "陌上", rating: 4, title: "受益良多", content: "观点扎实，案例贴近生活，读完很想立刻去实践其中的方法。", likes: 51 },
  ],
  [
    { nickname: "竹影扫阶", rating: 5, title: "醍醐灌顶", content: "一直以来困扰我的问题，被作者三言两语就讲透了，看完通体舒畅。", likes: 142 },
    { nickname: "半山听泉", rating: 4, title: "结构很清晰", content: "章节之间环环相扣，逻辑严密又不枯燥，适合反复咀嚼。", likes: 88 },
    { nickname: "青衫旧友", rating: 5, title: "改变了我", content: "读之前和读之后像是两个人，思考问题的方式都不一样了。", likes: 64 },
    { nickname: "拾光", rating: 3, title: "略有重复", content: "核心观点很好，只是后半部分稍显啰嗦，可以更精炼一些。", likes: 29 },
  ],
  [
    { nickname: "墨白", rating: 5, title: "常读常新", content: "第二遍读又有新的体会，好书就是这样，每个阶段都能照见自己。", likes: 117 },
    { nickname: "南窗", rating: 4, title: "诚意之作", content: "看得出作者的功力与真诚，没有故弄玄虚，朴实里见真章。", likes: 70 },
    { nickname: "知微", rating: 5, title: "强烈推荐", content: "送给正在迷茫的朋友，希望他也能从中获得一点力量。", likes: 55 },
    { nickname: "云归处", rating: 4, title: "好读又耐读", content: "一口气读完，又忍不住回头划了好多句子，准备做成笔记。", likes: 42 },
  ],
];

const avatarFor = (n: number) => ((n - 1) % 8) + 1;

export const reviewsByBook: Record<string, Review[]> = Object.fromEntries(
  books.map((bk, bi) => {
    const seeds = reviewSets[bi % reviewSets.length];
    return [
      bk.id,
      seeds.map((r, idx) => ({
        id: `${bk.id}-r${idx + 1}`,
        bookId: bk.id,
        bookTitle: bk.title,
        bookCoverSeed: bk.coverSeed,
        bookCover: bk.cover,
        userId: `u${bi}_${idx + 1}`,
        nickname: r.nickname,
        avatarSeed: avatarFor(bi + idx + 2),
        rating: r.rating,
        title: r.title,
        content: r.content,
        likes: r.likes,
        liked: false,
        createdAt: `2026-0${(idx % 5) + 1}-1${idx}T10:00:00Z`,
      })),
    ];
  })
);

export const profile: UserProfile = {
  id: "me",
  nickname: "书友·淮安",
  bio: "在书中遇见更好的自己",
  email: "huaianshuyou@163.com",
  avatarSeed: 7,
  stats: { hours: 36, read: 12, notes: 48, reviews: 9 },
};

export const myFavorites = ["mindset", "cipoetry", "courage", "intimacy", "deepwork", "willpower"];

export const myHistory: HistoryItem[] = [
  { bookId: "mindset", bookTitle: "终身成长", author: "卡罗尔·德韦克", coverSeed: 1, cover: "/covers/mindset.png", mode: "text", progress: 63, lastAt: new Date().toISOString() },
  { bookId: "cipoetry", bookTitle: "人间词话", author: "王国维", coverSeed: 2, cover: "/covers/cipoetry.png", mode: "audio", progress: 20, lastAt: new Date(Date.now() - 86400000).toISOString() },
  { bookId: "courage", bookTitle: "被讨厌的勇气", author: "岸见一郎·古贺史健", coverSeed: 3, cover: "/covers/courage.png", mode: "video", progress: 100, lastAt: new Date(Date.now() - 3 * 86400000).toISOString() },
];

export const myNotes: NoteItem[] = [
  {
    id: "n1",
    bookId: "mindset",
    bookTitle: "终身成长",
    bookCoverSeed: 1,
    chapterId: "mindset-c2",
    chapterTitle: "第二章 思维模式解析",
    excerpt: "能力可以通过练习来培养。",
    note: "把挑战看作练习，而不是定论。",
    color: "#8FB39B",
    createdAt: "2026-05-18T10:00:00Z",
  },
  {
    id: "n2",
    bookId: "mindset",
    bookTitle: "终身成长",
    bookCoverSeed: 1,
    chapterId: "mindset-c4",
    chapterTitle: "第四章 成长型思维的应用",
    excerpt: "努力不是为了证明聪明，而是为了持续成长。",
    note: "记录下今天的一小步进步。",
    color: "#D9C08A",
    createdAt: "2026-05-21T10:00:00Z",
  },
  {
    id: "n3",
    bookId: "cipoetry",
    bookTitle: "人间词话",
    bookCoverSeed: 2,
    chapterId: "cipoetry-c1",
    chapterTitle: "第一章 境界说",
    excerpt: "有境界则自成高格，自有名句。",
    note: "境界二字，是全书之眼。",
    color: "#D69A95",
    createdAt: "2026-05-12T10:00:00Z",
  },
];

export const myReviews: Review[] = [
  {
    id: "mr1",
    bookId: "mindset",
    bookTitle: "终身成长",
    bookCoverSeed: 1,
    bookCover: "/covers/mindset.png",
    userId: "me",
    nickname: "书友·淮安",
    avatarSeed: 7,
    rating: 5,
    content: "成长型思维让我重新理解了努力的意义，也看见了改变自己的可能。强烈推荐。",
    likes: 128,
    createdAt: "2026-05-28T10:00:00Z",
    mine: true,
  },
  {
    id: "mr2",
    bookId: "cipoetry",
    bookTitle: "人间词话",
    bookCoverSeed: 2,
    bookCover: "/covers/cipoetry.png",
    userId: "me",
    nickname: "书友·淮安",
    avatarSeed: 7,
    rating: 5,
    content: "境界二字，如清泉入心。读来有古意，也有清醒的判断。",
    likes: 96,
    createdAt: "2026-05-21T10:00:00Z",
    mine: true,
  },
];

// 示例对话填充真实问答，使「历史对话」可点开还原上下文
export const sampleSessions: ChatSession[] = [
  {
    id: "s1",
    title: "推荐成长型思维的书",
    updatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    messages: [
      { id: "s1u1", role: "user", content: "推荐一本关于成长型思维的书" },
      {
        id: "s1a1",
        role: "assistant",
        content:
          "根据你的问题，我从馆藏里挑了几本很契合的书。\n\n首推 **《终身成长》**（卡罗尔·德韦克）：决定人生走向的并非天赋，而是思维模式。\n\n你可以点下方的推荐书目卡片，直接开始阅读。",
      },
    ],
  },
  {
    id: "s2",
    title: "人间词话讲了什么",
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    messages: [
      { id: "s2u1", role: "user", content: "帮我总结《人间词话》" },
      {
        id: "s2a1",
        role: "assistant",
        content:
          "关于《人间词话》，王国维以“境界说”重新评点中国古典词作，融汇中西美学。\n\n他认为“词以境界为最上，有境界则自成高格”。",
      },
    ],
  },
  {
    id: "s3",
    title: "心理学入门书单",
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    messages: [
      { id: "s3u1", role: "user", content: "图书馆里有哪些心理学的书" },
      {
        id: "s3a1",
        role: "assistant",
        content:
          "心理学分类下有不少好书，比如 **《终身成长》《被讨厌的勇气》《亲密关系》《自控力》**，从思维模式到人际关系都有覆盖。",
      },
    ],
  },
  {
    id: "s4",
    title: "如何坚持阅读习惯",
    updatedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
    messages: [
      { id: "s4u1", role: "user", content: "怎样才能坚持阅读习惯？" },
      {
        id: "s4a1",
        role: "assistant",
        content:
          "可以从《认知觉醒》开始：把目标拆小，每天只读几页，先建立“开始”的惯性，再让阅读慢慢变成自然而然的事。",
      },
    ],
  },
];

export const exampleQuestions = [
  "推荐一本关于成长型思维的书",
  "《终身成长》第一章讲了什么",
  "图书馆里有哪些心理学的书",
  "帮我总结《人间词话》",
];

export const hotSearches = ["人间词话", "活着", "人类简史", "认知觉醒"];
