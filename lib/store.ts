"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ChatSession,
  HistoryItem,
  NoteItem,
  Progress,
  ReadingMode,
  Review,
  UserProfile,
} from "@/lib/types";
import {
  profile,
  myFavorites,
  myHistory,
  myNotes,
  myReviews,
  myProgress,
  myReadChapters,
  myMediaProgress,
  myMediaPlayed,
  myReadSeconds,
} from "@/lib/mock/data";

/* ---------------- Auth ---------------- */
interface AuthState {
  user: UserProfile | null;
  hydrated: boolean;
  login: (account: string) => void;
  logout: () => void;
  setHydrated: () => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
}
export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      hydrated: false,
      login: (account: string) => {
        const isEmail = account.includes("@");
        set({
          user: {
            ...profile,
            account,
            email: isEmail ? account : profile.email,
          },
        });
        // 登录即载入“我的”同步数据（演示）
        useLibrary.getState().seed();
      },
      logout: () => {
        set({ user: null });
        // 退出登录清空本地“我的”数据，避免换账号串号
        useLibrary.getState().reset();
      },
      setHydrated: () => set({ hydrated: true }),
      updateProfile: (patch) => {
        const u = get().user;
        if (u) set({ user: { ...u, ...patch } });
      },
    }),
    {
      name: "ail-auth",
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    }
  )
);

/* ---------------- UI / Theme / Toast / LoginSheet / 搜索历史 ---------------- */
export type Theme = "light" | "dark";
export interface Toast {
  id: number;
  type: "success" | "error" | "info";
  msg: string;
}
interface UIState {
  hydrated: boolean;
  setHydrated: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  recentSearches: string[];
  addRecent: (q: string) => void;
  removeRecent: (q: string) => void;
  clearRecent: () => void;
  toasts: Toast[];
  toast: (msg: string, type?: Toast["type"]) => void;
  dismiss: (id: number) => void;
  loginOpen: boolean;
  pending: (() => void) | null;
  openLogin: (pending?: () => void) => void;
  closeLogin: () => void;
}
let toastId = 1;
export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      theme: "light",
      setTheme: (t) => set({ theme: t }),
      recentSearches: [],
      addRecent: (q) => {
        const v = q.trim();
        if (!v) return;
        // 最近搜索：按时间倒序，个人最多保留 5 条
        set({ recentSearches: [v, ...get().recentSearches.filter((x) => x !== v)].slice(0, 5) });
      },
      removeRecent: (q) => set({ recentSearches: get().recentSearches.filter((x) => x !== q) }),
      clearRecent: () => set({ recentSearches: [] }),
      toasts: [],
      toast: (msg, type = "success") => {
        const id = toastId++;
        set({ toasts: [...get().toasts, { id, msg, type }] });
        setTimeout(() => get().dismiss(id), 2800);
      },
      dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
      loginOpen: false,
      pending: null,
      openLogin: (pending) => set({ loginOpen: true, pending: pending ?? null }),
      closeLogin: () => set({ loginOpen: false, pending: null }),
    }),
    {
      name: "ail-ui",
      partialize: (s) => ({ theme: s.theme, recentSearches: s.recentSearches }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    }
  )
);

/* ---------------- Library: 用户数据 ---------------- */
interface LibState {
  hydrated: boolean;
  favorites: string[];
  notes: NoteItem[];
  progress: Record<string, Progress>;
  history: HistoryItem[];
  likedReviews: string[];
  likedBooks: string[];
  myReviews: Review[];
  mediaProgress: Record<string, number>; // 视频/音频「播放位置」（0-1，续播用；详情↔乱翻共享）
  mediaPlayed: Record<string, number>; // 视频/音频「真实播放覆盖比例」（0-1，只增；判定播完，排除拖动）
  readChapters: Record<string, string[]>; // 文字稿已读毕的章节 id（判定整本读完）
  readSeconds: number; // 累计阅读/收听时长（秒；音视频+文字之和，用于「我的-总时长」）
  setHydrated: () => void;
  seed: () => void; // 载入演示数据（登录时）
  reset: () => void; // 清空（退出登录时）
  isFav: (id: string) => boolean;
  toggleFav: (id: string) => boolean; // 返回切换后是否已收藏
  addNote: (n: NoteItem) => void;
  removeNote: (id: string) => void;
  updateNote: (id: string, note: string) => void; // 二次编辑笔记内容（笔记源不变）
  notesOfChapter: (bookId: string, chapterId: string) => NoteItem[];
  setProgress: (p: Progress) => void;
  pushHistory: (h: HistoryItem) => void;
  clearHistory: () => void;
  removeHistory: (bookId: string) => void;
  toggleLike: (id: string) => void; // 书评点赞
  isBookLiked: (id: string) => boolean;
  toggleBookLike: (id: string) => boolean; // 乱翻/书籍点赞
  addReview: (r: Review) => void;
  removeReview: (id: string) => void;
  upsertReview: (r: Review) => void; // 写/更新书评合一（按 bookId 覆盖我的那条）
  myReviewOf: (bookId: string) => Review | undefined;
  setMediaProgress: (bookId: string, pct: number) => void;
  getMediaProgress: (bookId: string) => number;
  setMediaPlayed: (bookId: string, frac: number) => void;
  markChapterRead: (bookId: string, chapterId: string) => void;
  addReadSeconds: (sec: number) => void; // 累加阅读/收听时长
}
const real = (id: string) => id.split("__")[0];
export const useLibrary = create<LibState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      favorites: [],
      notes: [],
      progress: {},
      history: [],
      likedReviews: [],
      likedBooks: [],
      myReviews: [],
      mediaProgress: {},
      mediaPlayed: {},
      readChapters: {},
      readSeconds: 0,
      setHydrated: () => set({ hydrated: true }),
      seed: () =>
        set({
          favorites: [...myFavorites],
          notes: [...myNotes],
          history: [...myHistory],
          myReviews: [...myReviews],
          // 阅读派生数据与演示 history 一并注入，保证「我的」总时长/已读/进行中 与 详情页进度自洽
          progress: { ...myProgress },
          readChapters: { ...myReadChapters },
          mediaProgress: { ...myMediaProgress },
          mediaPlayed: { ...myMediaPlayed },
          readSeconds: myReadSeconds,
        }),
      reset: () =>
        set({
          favorites: [],
          notes: [],
          history: [],
          myReviews: [],
          progress: {},
          likedReviews: [],
          likedBooks: [],
          mediaProgress: {},
          mediaPlayed: {},
          readChapters: {},
          readSeconds: 0,
        }),
      isFav: (id) => get().favorites.includes(real(id)),
      toggleFav: (id) => {
        const r = real(id);
        const has = get().favorites.includes(r);
        set({ favorites: has ? get().favorites.filter((x) => x !== r) : [r, ...get().favorites] });
        return !has;
      },
      addNote: (n) => set({ notes: [n, ...get().notes] }),
      removeNote: (id) => set({ notes: get().notes.filter((n) => n.id !== id) }),
      updateNote: (id, note) =>
        set({ notes: get().notes.map((n) => (n.id === id ? { ...n, note } : n)) }),
      notesOfChapter: (bookId, chapterId) =>
        get().notes.filter((n) => n.bookId === real(bookId) && n.chapterId === chapterId),
      setProgress: (p) => {
        const id = real(p.bookId);
        set({ progress: { ...get().progress, [id]: { ...p, bookId: id } } });
      },
      pushHistory: (h) => {
        // 去版本后缀；音频与视频本质是同一内容(音视频)，按「书+大类(av/text)」去重 → 音视频共用一条进度记录，与文字稿分开
        const id = real(h.bookId);
        const cat = (m: ReadingMode) => (m === "text" ? "text" : "av");
        set({ history: [{ ...h, bookId: id }, ...get().history.filter((x) => !(x.bookId === id && cat(x.mode) === cat(h.mode)))].slice(0, 50) });
      },
      clearHistory: () => set({ history: [] }),
      removeHistory: (bookId) =>
        set({ history: get().history.filter((x) => x.bookId !== real(bookId)) }),
      toggleLike: (id) =>
        set({
          likedReviews: get().likedReviews.includes(id)
            ? get().likedReviews.filter((x) => x !== id)
            : [id, ...get().likedReviews],
        }),
      isBookLiked: (id) => get().likedBooks.includes(real(id)),
      toggleBookLike: (id) => {
        const r = real(id);
        const has = get().likedBooks.includes(r);
        set({ likedBooks: has ? get().likedBooks.filter((x) => x !== r) : [r, ...get().likedBooks] });
        return !has;
      },
      addReview: (r) => set({ myReviews: [r, ...get().myReviews] }),
      removeReview: (id) =>
        set({ myReviews: get().myReviews.filter((r) => r.id !== id) }),
      upsertReview: (r) => {
        const id = real(r.bookId);
        set({ myReviews: [{ ...r, bookId: id }, ...get().myReviews.filter((x) => x.bookId !== id)] });
      },
      myReviewOf: (bookId) => get().myReviews.find((r) => r.bookId === real(bookId)),
      setMediaProgress: (bookId, pct) =>
        set({ mediaProgress: { ...get().mediaProgress, [real(bookId)]: Math.min(1, Math.max(0, pct)) } }),
      getMediaProgress: (bookId) => get().mediaProgress[real(bookId)] ?? 0,
      setMediaPlayed: (bookId, frac) => {
        const r = real(bookId);
        const prev = get().mediaPlayed[r] ?? 0;
        const next = Math.min(1, Math.max(prev, frac));
        if (next === prev) return;
        set({ mediaPlayed: { ...get().mediaPlayed, [r]: next } });
      },
      markChapterRead: (bookId, chapterId) => {
        const r = real(bookId);
        const cur = get().readChapters[r] ?? [];
        if (cur.includes(chapterId)) return;
        set({ readChapters: { ...get().readChapters, [r]: [...cur, chapterId] } });
      },
      addReadSeconds: (sec) => set({ readSeconds: get().readSeconds + Math.max(0, Math.round(sec)) }),
    }),
    {
      name: "ail-library",
      version: 2,
      // v1：文字进度口径改全书百分比；v2：进度全面改「实际读过的记录」(章节覆盖/真实播放覆盖)+历史按模式分别保留。
      // 清掉旧口径残留(进度/历史/媒体覆盖/时长)，避免老测试数据与新口径不一致；收藏/笔记/书评/点赞保留。
      migrate: (persisted: any, version: number) => {
        if (version < 2 && persisted) {
          persisted.progress = {};
          persisted.mediaProgress = {};
          persisted.mediaPlayed = {};
          persisted.readChapters = {};
          persisted.readSeconds = 0;
          persisted.history = [];
        }
        return persisted;
      },
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    }
  )
);

/* ---------------- Reader Prefs ---------------- */
export type ReaderBg = "white" | "moon" | "green" | "dark";
interface ReaderState {
  hydrated: boolean;
  fontSize: number; // 16/18/20/22
  bg: ReaderBg;
  brightness: number; // 0.5 - 1
  defaultMode: ReadingMode;
  setHydrated: () => void;
  setFontSize: (n: number) => void;
  setBg: (b: ReaderBg) => void;
  setBrightness: (n: number) => void;
  setDefaultMode: (m: ReadingMode) => void;
}
export const useReader = create<ReaderState>()(
  persist(
    (set) => ({
      hydrated: false,
      fontSize: 18,
      bg: "moon",
      brightness: 1,
      defaultMode: "text",
      setHydrated: () => set({ hydrated: true }),
      setFontSize: (n) => set({ fontSize: n }),
      setBg: (b) => set({ bg: b }),
      setBrightness: (n) => set({ brightness: n }),
      setDefaultMode: (m) => set({ defaultMode: m }),
    }),
    {
      name: "ail-reader",
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    }
  )
);

/* ---------------- Chat ---------------- */
interface ChatState {
  sessions: ChatSession[];
  hiddenSamples: string[]; // 被用户删除/清空的示例会话 id（持久化，刷新后不再复现）
  upsertSession: (s: ChatSession) => void;
  removeSession: (id: string) => void;
  clearSessions: () => void;
  hideSample: (id: string) => void;
  hideAllSamples: (ids: string[]) => void;
}
export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      hiddenSamples: [],
      upsertSession: (s) =>
        set({
          sessions: [s, ...get().sessions.filter((x) => x.id !== s.id)].sort(
            (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
          ),
        }),
      removeSession: (id) => set({ sessions: get().sessions.filter((x) => x.id !== id) }),
      clearSessions: () => set({ sessions: [] }),
      hideSample: (id) => set({ hiddenSamples: Array.from(new Set([...get().hiddenSamples, id])) }),
      hideAllSamples: (ids) => set({ hiddenSamples: Array.from(new Set([...get().hiddenSamples, ...ids])) }),
    }),
    { name: "ail-chat" }
  )
);

/** 统一的"需登录"包装：未登录则弹登录抽屉并把操作挂起，登录后执行 */
export function requireLogin(action: () => void) {
  const { user } = useAuth.getState();
  if (user) {
    action();
  } else {
    useUI.getState().openLogin(action);
  }
}
