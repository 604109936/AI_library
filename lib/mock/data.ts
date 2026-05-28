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
  { id: "psy", name: "心理学", count: 128, icon: "Brain" },
  { id: "biz", name: "商业", count: 96, icon: "TrendingUp" },
  { id: "lit", name: "文学", count: 154, icon: "Feather" },
  { id: "his", name: "历史", count: 87, icon: "Landmark" },
  { id: "tech", name: "科技", count: 73, icon: "Cpu" },
  { id: "growth", name: "自我成长", count: 142, icon: "Sprout" },
];

interface RawBook {
  id: string;
  title: string;
  author: string;
  categoryId: string;
  tags: string[];
  summary: string;
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
    rating: 4.5,
    readers: 587000,
    words: 256000,
    modes: ["audio", "text"],
    intro: "人类社会的命运",
    chapterTitles: ["人类社会的起跑线", "粮食生产的扩散", "病菌的礼物", "文字的演化", "地理决定论"],
  },
];

const para = (book: RawBook, ch: string) =>
  [
    `${ch}。在本章中，《${book.title}》围绕“${ch}”这一主题展开论述。作者${book.author}以清晰的逻辑与丰富的案例，引导读者重新审视习以为常的观念。`,
    `真正决定一个人能走多远的，并非起点的高低，而是他如何理解失败、如何对待挑战。当一个人愿意把困难视为可以练习的环节，心智便不再被一时的挫折束缚。`,
    `${book.summary}`,
    `相反，若把天赋当作唯一的尺度，每一次失败都会成为沉重的负担。本章提醒我们：成长是一个渐进而持续的过程，关键在于找到适合自己的方法并长久地坚持。`,
    `当我们把这一原则应用到日常的学习与工作中，便会发现，改变正在悄然发生——它改变了我们面对世界的姿态，也改变了未来展开的方向。`,
  ].join("\n\n");

export const books: Book[] = raw.map((b, i) => ({
  id: b.id,
  title: b.title,
  author: b.author,
  cover: "",
  coverSeed: i + 1,
  category: categories.find((c) => c.id === b.categoryId)!.name,
  categoryId: b.categoryId,
  tags: b.tags,
  summary: b.summary,
  rating: b.rating,
  readers: b.readers,
  words: b.words,
  durationMin: Math.round(b.words / 400),
  hasVideo: b.modes.includes("video"),
  hasAudio: b.modes.includes("audio"),
  hasText: b.modes.includes("text"),
  videoUrl: b.modes.includes("video")
    ? "https://www.w3schools.com/html/mov_bbb.mp4"
    : undefined,
  audioUrl: b.modes.includes("audio")
    ? "https://www.w3schools.com/html/horse.mp3"
    : undefined,
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
      content: para(b, t),
      status: idx === 0 ? "reading" : idx === 1 ? "read" : "unread",
    })),
  ])
);

const reviewSeeds = [
  { nickname: "松窗夜读", rating: 5, title: "纸上有清气", content: "行云流畅，娓娓道来。人物心绪层层铺开，读来余味悠长，是近来难得的好书。", likes: 128 },
  { nickname: "山月", rating: 4, title: "克制而温润", content: "语言干净，几处描写恰到好处，留三分余地给读者想象，反而更有力量。", likes: 96 },
  { nickname: "听雨书生", rating: 5, title: "值得慢慢读", content: "节奏舒缓，合上书的那一刻仍念念不忘，把它放在床头，时不时翻一翻。", likes: 73 },
  { nickname: "陌上", rating: 4, title: "受益良多", content: "观点扎实，案例贴近生活，读完很想立刻去实践其中的方法。", likes: 51 },
];

export const reviewsByBook: Record<string, Review[]> = Object.fromEntries(
  books.map((bk) => [
    bk.id,
    reviewSeeds.map((r, idx) => ({
      id: `${bk.id}-r${idx + 1}`,
      bookId: bk.id,
      bookTitle: bk.title,
      bookCoverSeed: bk.coverSeed,
      userId: `u${idx + 1}`,
      nickname: r.nickname,
      avatarSeed: idx + 1,
      rating: r.rating,
      title: r.title,
      content: r.content,
      likes: r.likes,
      liked: false,
      createdAt: `2026-0${(idx % 5) + 1}-1${idx}T10:00:00Z`,
    })),
  ])
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
  { bookId: "mindset", bookTitle: "终身成长", coverSeed: 1, mode: "text", progress: 63, lastAt: new Date().toISOString() },
  { bookId: "cipoetry", bookTitle: "人间词话", coverSeed: 2, mode: "audio", progress: 20, lastAt: new Date(Date.now() - 86400000).toISOString() },
  { bookId: "courage", bookTitle: "被讨厌的勇气", coverSeed: 3, mode: "video", progress: 100, lastAt: new Date(Date.now() - 3 * 86400000).toISOString() },
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
    color: "#E7C66B",
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
    color: "#8FB39B",
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
    color: "#7FA6C9",
    createdAt: "2026-05-12T10:00:00Z",
  },
];

export const myReviews: Review[] = [
  {
    id: "mr1",
    bookId: "mindset",
    bookTitle: "终身成长",
    bookCoverSeed: 1,
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

export const sampleSessions: ChatSession[] = [
  { id: "s1", title: "推荐成长型思维的书", updatedAt: new Date().toISOString(), messages: [] },
  { id: "s2", title: "人间词话讲了什么", updatedAt: new Date(Date.now() - 86400000).toISOString(), messages: [] },
  { id: "s3", title: "心理学入门书单", updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(), messages: [] },
  { id: "s4", title: "如何坚持阅读习惯", updatedAt: new Date(Date.now() - 8 * 86400000).toISOString(), messages: [] },
];

export const exampleQuestions = [
  "推荐一本关于成长型思维的书",
  "《终身成长》第一章讲了什么",
  "图书馆里有哪些心理学的书",
  "帮我总结《人间词话》",
];

export const hotSearches = ["人间词话", "亲密关系", "深度工作", "认知觉醒"];
