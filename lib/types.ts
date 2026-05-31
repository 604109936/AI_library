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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  recommendations?: Book[];
  feedback?: "up" | "down";
  streaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
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
