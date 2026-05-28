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
  login: (email: string) => void;
  logout: () => void;
  setHydrated: () => void;
  updateProfile: (patch: Partial<UserProfile>) => void;
}
export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      hydrated: false,
      login: (account: string) =>
        set({ user: { ...profile, email: account.includes("@") ? account : profile.email } }),
      logout: () => set({ user: null }),
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

/* ---------------- UI / Theme / Toast / LoginSheet ---------------- */
export type Theme = "light" | "dark" | "system";
export interface Toast {
  id: number;
  type: "success" | "error" | "info";
  msg: string;
}
interface UIState {
  theme: Theme;
  setTheme: (t: Theme) => void;
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
      toasts: [],
      toast: (msg, type = "success") => {
        const id = toastId++;
        set({ toasts: [...get().toasts, { id, msg, type }] });
        setTimeout(() => get().dismiss(id), 2500);
      },
      dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
      loginOpen: false,
      pending: null,
      openLogin: (pending) => set({ loginOpen: true, pending: pending ?? null }),
      closeLogin: () => set({ loginOpen: false, pending: null }),
    }),
    { name: "ail-ui", partialize: (s) => ({ theme: s.theme }) }
  )
);

/* ---------------- Library: 用户数据 ---------------- */
interface LibState {
  favorites: string[];
  notes: NoteItem[];
  progress: Record<string, Progress>;
  history: HistoryItem[];
  likedReviews: string[];
  myReviews: Review[];
  isFav: (id: string) => boolean;
  toggleFav: (id: string) => boolean; // 返回切换后是否已收藏
  addNote: (n: NoteItem) => void;
  removeNote: (id: string) => void;
  setProgress: (p: Progress) => void;
  pushHistory: (h: HistoryItem) => void;
  clearHistory: () => void;
  removeHistory: (bookId: string) => void;
  toggleLike: (id: string) => void;
  addReview: (r: Review) => void;
  removeReview: (id: string) => void;
}
export const useLibrary = create<LibState>()(
  persist(
    (set, get) => ({
      favorites: myFavorites,
      notes: myNotes,
      progress: {},
      history: myHistory,
      likedReviews: [],
      myReviews,
      isFav: (id) => get().favorites.includes(id.split("__")[0]),
      toggleFav: (id) => {
        const real = id.split("__")[0];
        const has = get().favorites.includes(real);
        set({
          favorites: has
            ? get().favorites.filter((x) => x !== real)
            : [real, ...get().favorites],
        });
        return !has;
      },
      addNote: (n) => set({ notes: [n, ...get().notes] }),
      removeNote: (id) => set({ notes: get().notes.filter((n) => n.id !== id) }),
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
      addReview: (r) => set({ myReviews: [r, ...get().myReviews] }),
      removeReview: (id) =>
        set({ myReviews: get().myReviews.filter((r) => r.id !== id) }),
    }),
    { name: "ail-library" }
  )
);

/* ---------------- Reader Prefs ---------------- */
export type ReaderBg = "white" | "moon" | "green" | "dark";
interface ReaderState {
  fontSize: number; // 16/18/20/22
  bg: ReaderBg;
  pageMode: "scroll" | "page";
  setFontSize: (n: number) => void;
  setBg: (b: ReaderBg) => void;
  setPageMode: (m: "scroll" | "page") => void;
}
export const useReader = create<ReaderState>()(
  persist(
    (set) => ({
      fontSize: 18,
      bg: "moon",
      pageMode: "scroll",
      setFontSize: (n) => set({ fontSize: n }),
      setBg: (b) => set({ bg: b }),
      setPageMode: (m) => set({ pageMode: m }),
    }),
    { name: "ail-reader" }
  )
);

/* ---------------- Chat ---------------- */
interface ChatState {
  sessions: ChatSession[];
  currentId: string | null;
  newSession: () => string;
  setCurrent: (id: string | null) => void;
  upsertSession: (s: ChatSession) => void;
  removeSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
}
export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentId: null,
      newSession: () => {
        const id = "sess-" + Date.now();
        const s: ChatSession = { id, title: "新对话", updatedAt: new Date().toISOString(), messages: [] };
        set({ sessions: [s, ...get().sessions], currentId: id });
        return id;
      },
      setCurrent: (id) => set({ currentId: id }),
      upsertSession: (s) =>
        set({
          sessions: [s, ...get().sessions.filter((x) => x.id !== s.id)].sort(
            (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
          ),
        }),
      removeSession: (id) =>
        set({
          sessions: get().sessions.filter((x) => x.id !== id),
          currentId: get().currentId === id ? null : get().currentId,
        }),
      renameSession: (id, title) =>
        set({ sessions: get().sessions.map((x) => (x.id === id ? { ...x, title } : x)) }),
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
