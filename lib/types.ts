export type ReadingMode = "video" | "audio" | "text";
export type ReadStatus = "unread" | "reading" | "read";

export interface Book {
  id: string;
  title: string;
  author: string;
  cover: string; // 真实封面图路径（/covers/{id}.png）；为空时前端按 coverSeed 渲染 CSS 兜底封面
  coverSeed: number;
  heroUrl?: string; // 详情页氛围大图（台座/竹影）
  posterUrl?: string; // 乱翻竖屏视频海报/首帧
  avatarUrl?: string; // 作者/博主头像
  category: string;
  categoryId: string;
  tags: string[];
  summary: string;
  rating: number; // 0-5
  readers: number;
  words: number; // 字数
  durationMin: number; // 预估阅读分钟
  hasVideo: boolean;
  hasAudio: boolean;
  hasText: boolean;
  videoUrl?: string;
  audioUrl?: string;
  likes: number; // 乱翻点赞数
  favCount: number; // 收藏数
  reviewCount: number; // 书评数
  featured: boolean;
  intro: string; // 乱翻一句话
  createdAt?: string; // [已弃用] 旧出版时间；热门好书排序已改用 shelvedAt，待接 Supabase 时移除本字段
  shelvedAt: string; // 入库时间（ISO；分类默认排序 / Banner 取每类最新 / 热门好书由远到近排序）
}

export interface Chapter {
  id: string;
  bookId: string;
  no: number;
  title: string;
  content: string; // 正文（mock）
  status?: ReadStatus;
  audioStart?: number; // 该章在整书音频中的起始秒（mock 切章 seek 用）
}

export interface Category {
  id: string;
  name: string;
  count: number;
  icon: string; // lucide name
}

export interface Review {
  id: string;
  bookId: string;
  bookTitle?: string;
  bookCoverSeed?: number;
  bookCover?: string;
  userId: string;
  nickname: string;
  avatarSeed: number;
  avatarUrl?: string;
  rating: number;
  title?: string;
  content: string;
  likes: number;
  liked?: boolean;
  createdAt: string;
  mine?: boolean;
}

export interface NoteItem {
  id: string;
  bookId: string;
  bookTitle: string;
  bookCoverSeed: number;
  chapterId: string;
  chapterTitle: string;
  excerpt: string; // 原文摘录
  note: string; // 我的笔记
  color: string; // 高亮色
  start?: number; // 摘录在本章正文中的起始字符偏移（精确定位重复文本；旧数据无此字段时回退 indexOf）
  end?: number; // 结束字符偏移
  createdAt: string;
}

export interface Citation {
  bookId: string;
  bookTitle: string;
  coverSeed: number;
  cover?: string;
  chapterNo: number;
  chapterTitle: string;
  snippet: string;
}

// 联网搜索来源（T10）：title/url/date，渲染「来源」卡组（外链）
export interface WebSource {
  t: string;
  u: string;
  d: string;
  q?: string; // 这批资料对应的搜索词（前端在来源卡头展示「联网搜索「<q>」」，让用户知道哪批资料来自哪次搜索）
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // 卡片交错渲染：content 内嵌占位标记 [[recs:起,止]]/[[cites:起,止]]/[[web:起,止]]，指向下面数组的切片，
  // 卡片渲染在工具调用的真实位置（无标记的老消息回退末尾渲染）；标记随 content 落库
  citations?: Citation[];
  recommendations?: Book[];
  webSources?: WebSource[];
  feedback?: "up" | "down";
  feedbackReasons?: string[]; // 踩反馈原因标签（推荐偏差/答疑有误/解读没用/其它）
  feedbackText?: string; // 「其它」自定义反馈文本
  streaming?: boolean;
  voicePending?: boolean; // 语音输入占位：松手后用户气泡先显「…」，识别完替换成语音文字（不进上下文）
  toolNote?: string; // 工具调用中文案（查找书籍…/翻阅图书…/章节浏览…），仅流式期间展示
  error?: boolean; // 错误/中断占位消息：组装上下文时剔除（防模型把报错文案当成自己说过的话）
  truncated?: boolean; // 断线截断：content 仅存模型真实正文（不含尾注），尾注由渲染层据此追加，绝不进回灌上下文（Bug#11）
}

export interface ChatSession {
  id: string;
  title: string;
  ownerUid?: string; // 本地归属标记（uid 或 "guest"），换账号防串档；不入库
  updatedAt: string;
  messages: ChatMessage[];
}

export interface HistoryItem {
  bookId: string;
  bookTitle: string;
  author?: string;
  coverSeed: number;
  cover?: string;
  mode: ReadingMode;
  progress: number; // 0-100
  lastAt: string;
}

export interface Progress {
  bookId: string;
  chapterId: string;
  chapterNo: number;
  pct: number;
  mode: ReadingMode;
}

export interface UserProfile {
  id: string;
  nickname: string;
  bio: string;
  email: string;
  account?: string; // 登录账号（账号密码登录时填入）
  avatarSeed: number;
  avatarUrl?: string;
  stats: { hours: number; read: number; notes: number; reviews: number };
}

export interface Paged<T> {
  items: T[];
  nextCursor: number | null;
  hasMore: boolean;
}
