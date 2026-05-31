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

/* ---------------- UI / Theme / Toast / LoginSheet / 通知 / 搜索历史 ---------------- */
export type Theme = "light" | "dark" | "system";
export interface Toast {
  id: number;
  type: "success" | "error" | "info";
  msg: string;
}
export interface NotifyPrefs {
  push: boolean;
  weekly: boolean;
}
interface UIState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  notify: NotifyPrefs;
  setNotify: (patch: Partial<NotifyPrefs>) => void;
  recentSearches: string[];
  addRecent: (q: string) => void;
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
      theme: "light",
      setTheme: (t) => set({ theme: t }),
      notify: { push: true, weekly: true },
      setNotify: (patch) => set({ notify: { ...get().notify, ...patch } }),
      recentSearches: [],
      addRecent: (q) => {
        const v = q.trim();
        if (!v) return;
        set({ recentSearches: [v, ...get().recentSearches.filter((x) => x !== v)].slice(0, 10) });
      },
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
      partialize: (s) => ({ theme: s.theme, notify: s.notify, recentSearches: s.recentSearches }),
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
  setHydrated: () => void;
  seed: () => void; // 载入演示数据（登录时）
  reset: () => void; // 清空（退出登录时）
  isFav: (id: string) => boolean;
  toggleFav: (id: string) => boolean; // 返回切换后是否已收藏
  addNote: (n: NoteItem) => void;
  removeNote: (id: string) => void;
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
      setHydrated: () => set({ hydrated: true }),
      seed: () =>
        set({
          favorites: [...myFavorites],
          notes: [...myNotes],
          history: [...myHistory],
          myReviews: [...myReviews],
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
      notesOfChapter: (bookId, chapterId) =>
        get().notes.filter((n) => n.bookId === real(bookId) && n.chapterId === chapterId),
      setProgress: (p) => set({ progress: { ...get().progress, [p.bookId]: p } }),
      pushHistory: (h) =>
        set({
          history: [h, ...get().history.filter((x) => x.bookId !== h.bookId)].slice(0, 50),
        }),
      clearHistory: () => set({ history: [] }),
      removeHistory: (bookId) =>
        set({ history: get().history.filter((x) => x.bookId !== bookId) }),
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
    }),
    {
      name: "ail-library",
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
  pageMode: "scroll" | "page";
  brightness: number; // 0.5 - 1
  defaultMode: ReadingMode;
  setHydrated: () => void;
  setFontSize: (n: number) => void;
  setBg: (b: ReaderBg) => void;
  setPageMode: (m: "scroll" | "page") => void;
  setBrightness: (n: number) => void;
  setDefaultMode: (m: ReadingMode) => void;
}
export const useReader = create<ReaderState>()(
  persist(
    (set) => ({
      hydrated: false,
      fontSize: 18,
      bg: "moon",
      pageMode: "scroll",
      brightness: 1,
      defaultMode: "text",
      setHydrated: () => set({ hydrated: true }),
      setFontSize: (n) => set({ fontSize: n }),
      setBg: (b) => set({ bg: b }),
      setPageMode: (m) => set({ pageMode: m }),
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
  upsertSession: (s: ChatSession) => void;
  removeSession: (id: string) => void;
  clearSessions: () => void;
}
export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      upsertSession: (s) =>
        set({
          sessions: [s, ...get().sessions.filter((x) => x.id !== s.id)].sort(
            (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
          ),
        }),
      removeSession: (id) => set({ sessions: get().sessions.filter((x) => x.id !== id) }),
      clearSessions: () => set({ sessions: [] }),
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
