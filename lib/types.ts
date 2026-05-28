export type ReadingMode = "video" | "audio" | "text";
export type ReadStatus = "unread" | "reading" | "read";

export interface Book {
  id: string;
  title: string;
  author: string;
  cover: string; // 渐变/纯色占位（新中式极简封面）由前端按 coverSeed 渲染
  coverSeed: number;
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
  userId: string;
  nickname: string;
  avatarSeed: number;
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
  createdAt: string;
}

export interface Citation {
  bookId: string;
  bookTitle: string;
  coverSeed: number;
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
  coverSeed: number;
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
  avatarSeed: number;
  stats: { hours: number; read: number; notes: number; reviews: number };
}

export interface Paged<T> {
  items: T[];
  nextCursor: number | null;
  hasMore: boolean;
}
