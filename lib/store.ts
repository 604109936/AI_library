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
import { supabase } from "@/lib/supabase/client";
import { loadUserData, loadChatSessions, chatDb, db } from "@/lib/supabase/userdata";

/* ---------------- Auth（接 Supabase Auth） ---------------- */
// profiles + auth.users.email → UserProfile。stats 由前端各页实时计算，这里置 0（不用 user.stats）。
async function loadProfile(authUser: any): Promise<UserProfile> {
  const { data } = await supabase.from("profiles").select("*").eq("id", authUser.id).maybeSingle();
  return {
    id: authUser.id,
    nickname: data?.nickname ?? authUser.email?.split("@")[0] ?? "书友",
    bio: data?.bio ?? "",
    email: authUser.email ?? "",
    account: data?.account ?? authUser.email ?? "",
    avatarSeed: data?.avatar_seed ?? 1,
    avatarUrl: data?.avatar_url ?? undefined,
    stats: { hours: 0, read: 0, notes: 0, reviews: 0 },
  };
}

interface AuthState {
  user: UserProfile | null;
  hydrated: boolean; // 是否已完成首屏会话恢复
  initAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (email: string, password: string, nickname?: string) => Promise<{ error?: string; needConfirm?: boolean }>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
}
let authSubscribed = false;
export const useAuth = create<AuthState>()((set, get) => ({
  user: null,
  hydrated: false,
  // 首屏：恢复 Supabase 会话（刷新不掉线）+ 订阅登录态变化
  initAuth: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      try {
        const p = await loadProfile(data.session.user);
        set({ user: p });
        await useLibrary.getState().load(p);
        await useChat.getState().loadCloud(p.id);
      } catch {}
    } else {
      useLibrary.getState().setHydrated();
    }
    set({ hydrated: true });
    if (!authSubscribed) {
      authSubscribed = true;
      supabase.auth.onAuthStateChange((event, sess) => {
        if (event === "SIGNED_OUT") {
          set({ user: null });
          useLibrary.getState().reset();
          useChat.getState().resetLocal();
        } else if (sess?.user && (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED")) {
          loadProfile(sess.user).then((p) => set({ user: p })).catch(() => {});
        }
      });
    }
  },
  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { error: error.message };
    if (data.user) {
      const p = await loadProfile(data.user);
      set({ user: p });
      await useLibrary.getState().load(p);
      await useChat.getState().loadCloud(p.id);
    }
    return {};
  },
  register: async (email, password, nickname) => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) return { error: error.message };
    const u = data.user;
    if (!u) return { error: "注册失败，请重试" };
    if (nickname?.trim()) {
      await supabase.from("profiles").update({ nickname: nickname.trim() }).eq("id", u.id);
    }
    if (!data.session) return { needConfirm: true }; // 邮箱验证未关闭时无会话
    const p = await loadProfile(u);
    set({ user: p });
    await useLibrary.getState().load(p);
    await useChat.getState().loadCloud(p.id);
    return {};
  },
  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null });
    useLibrary.getState().reset();
    useChat.getState().resetLocal(); // 对话只清本地，云端永久保留
  },
  updateProfile: async (patch) => {
    const u = get().user;
    if (!u) return;
    set({ user: { ...u, ...patch } }); // 乐观更新
    const db: Record<string, any> = {};
    if (patch.nickname !== undefined) db.nickname = patch.nickname;
    if (patch.bio !== undefined) db.bio = patch.bio;
    if (patch.avatarSeed !== undefined) db.avatar_seed = patch.avatarSeed;
    if (patch.avatarUrl !== undefined) db.avatar_url = patch.avatarUrl;
    if (Object.keys(db).length) await supabase.from("profiles").update(db).eq("id", u.id);
  },
}));

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

/* ---------------- Library: 用户数据（接 Supabase：登录后加载 + 各操作写穿透） ---------------- */
// 不再 localStorage 持久化——Supabase 为唯一事实源；登录后 load 拉取本人数据，退出 reset 清空。
// 各 mutation：本地乐观更新（保持同步 API，组件不改）+ 异步写回 Supabase（失败 toast 提示）。
interface LibState {
  hydrated: boolean;
  favorites: string[];
  notes: NoteItem[];
  progress: Record<string, Progress>;
  history: HistoryItem[];
  likedReviews: string[];
  likedBooks: string[];
  myReviews: Review[];
  mediaProgress: Record<string, number>;
  mediaPlayed: Record<string, number>;
  readChapters: Record<string, string[]>;
  readSeconds: number;
  setHydrated: () => void;
  load: (user: { id: string; nickname: string; avatarSeed: number }) => Promise<void>; // 登录后从 Supabase 加载本人数据
  reset: () => void; // 退出登录清空
  isFav: (id: string) => boolean;
  toggleFav: (id: string) => boolean;
  addNote: (n: NoteItem) => void;
  removeNote: (id: string) => void;
  updateNote: (id: string, note: string) => void;
  notesOfChapter: (bookId: string, chapterId: string) => NoteItem[];
  setProgress: (p: Progress) => void;
  pushHistory: (h: HistoryItem) => void;
  clearHistory: () => void;
  removeHistory: (bookId: string) => void;
  toggleLike: (id: string) => void;
  isBookLiked: (id: string) => boolean;
  toggleBookLike: (id: string) => boolean;
  addReview: (r: Review) => void;
  removeReview: (id: string) => void;
  upsertReview: (r: Review) => void;
  myReviewOf: (bookId: string) => Review | undefined;
  setMediaProgress: (bookId: string, pct: number) => void;
  getMediaProgress: (bookId: string) => number;
  setMediaPlayed: (bookId: string, frac: number) => void;
  markChapterRead: (bookId: string, chapterId: string) => void;
  addReadSeconds: (sec: number) => void;
}
const real = (id: string) => id.split("__")[0];
const EMPTY = {
  favorites: [] as string[],
  notes: [] as NoteItem[],
  history: [] as HistoryItem[],
  myReviews: [] as Review[],
  progress: {} as Record<string, Progress>,
  likedReviews: [] as string[],
  likedBooks: [] as string[],
  mediaProgress: {} as Record<string, number>,
  mediaPlayed: {} as Record<string, number>,
  readChapters: {} as Record<string, string[]>,
  readSeconds: 0,
};
export const useLibrary = create<LibState>()((set, get) => {
  const uid = () => useAuth.getState().user?.id;
  const fail = (label: string) => useUI.getState().toast(`${label}同步失败`, "error");
  const sync = (p: any, label: string) => {
    Promise.resolve(p)
      .then((res: any) => { if (res?.error) { console.error(`[同步失败:${label}]`, res.error); fail(label); } })
      .catch((e: any) => { console.error(`[同步异常:${label}]`, e); fail(label); });
  };
  // 文字进度/媒体进度：写库时取当前完整一行（避免分列覆盖）
  const syncText = (bookId: string) => {
    const u = uid();
    if (u) sync(db.setTextProgress(u, bookId, get().progress[bookId], get().readChapters[bookId] ?? []), "进度");
  };
  // 媒体进度同步：5 秒节流（首调即写、其后合并为每 5 秒一次尾写），避免播放时每帧 onTimeUpdate 触发数次/秒的 DB upsert
  const mediaSyncTimer: Record<string, ReturnType<typeof setTimeout>> = {};
  const mediaSyncAt: Record<string, number> = {};
  const syncMedia = (bookId: string) => {
    const u = uid();
    if (!u) return;
    const flushNow = () => { mediaSyncAt[bookId] = Date.now(); sync(db.setMediaProgress(u, bookId, get().mediaProgress[bookId] ?? 0, get().mediaPlayed[bookId] ?? 0), "进度"); };
    const since = Date.now() - (mediaSyncAt[bookId] ?? 0);
    if (since >= 5000) { if (mediaSyncTimer[bookId]) { clearTimeout(mediaSyncTimer[bookId]); delete mediaSyncTimer[bookId]; } flushNow(); }
    else if (!mediaSyncTimer[bookId]) { mediaSyncTimer[bookId] = setTimeout(() => { delete mediaSyncTimer[bookId]; flushNow(); }, 5000 - since); }
  };
  return {
    hydrated: false,
    ...EMPTY,
    setHydrated: () => set({ hydrated: true }),
    load: async (user) => {
      try {
        const d = await loadUserData(user);
        set({ ...d, hydrated: true });
      } catch {
        set({ hydrated: true });
      }
    },
    reset: () => set({ ...EMPTY, hydrated: true }),
    isFav: (id) => get().favorites.includes(real(id)),
    toggleFav: (id) => {
      const r = real(id);
      const has = get().favorites.includes(r);
      set({ favorites: has ? get().favorites.filter((x) => x !== r) : [r, ...get().favorites] });
      const u = uid();
      if (u) sync(has ? db.removeFav(u, r) : db.addFav(u, r), "收藏");
      return !has;
    },
    addNote: (n) => {
      set({ notes: [n, ...get().notes] });
      const u = uid();
      if (u) sync(db.addNote(u, { ...n, bookId: real(n.bookId) }), "笔记");
    },
    removeNote: (id) => {
      set({ notes: get().notes.filter((n) => n.id !== id) });
      const u = uid();
      if (u) sync(db.removeNote(id), "笔记");
    },
    updateNote: (id, note) => {
      set({ notes: get().notes.map((n) => (n.id === id ? { ...n, note } : n)) });
      const u = uid();
      if (u) sync(db.updateNote(id, note), "笔记");
    },
    notesOfChapter: (bookId, chapterId) =>
      get().notes.filter((n) => n.bookId === real(bookId) && n.chapterId === chapterId),
    setProgress: (p) => {
      const id = real(p.bookId);
      set({ progress: { ...get().progress, [id]: { ...p, bookId: id } } });
      syncText(id);
    },
    pushHistory: (h) => {
      // 音视频本质同一内容，按「书+大类(av/text)」去重 → 音视频共用一条，与文字稿分开
      const id = real(h.bookId);
      const cat = (m: ReadingMode) => (m === "text" ? "text" : "av");
      const top = get().history[0];
      if (top && top.bookId === id && cat(top.mode) === cat(h.mode) && top.progress === h.progress) return; // 已在最前且进度未变 → 不重复 set/写库
      set({ history: [{ ...h, bookId: id }, ...get().history.filter((x) => !(x.bookId === id && cat(x.mode) === cat(h.mode)))].slice(0, 50) });
      const u = uid();
      if (u) sync(db.pushHistory(u, id, h.mode, h.progress, h.lastAt), "历史");
    },
    clearHistory: () => {
      set({ history: [] });
      const u = uid();
      if (u) sync(db.clearHistory(u), "历史");
    },
    removeHistory: (bookId) => {
      const id = real(bookId);
      set({ history: get().history.filter((x) => x.bookId !== id) });
      const u = uid();
      if (u) sync(db.removeHistory(u, id), "历史");
    },
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
    addReview: (r) => {
      set({ myReviews: [r, ...get().myReviews] });
      const u = uid();
      if (u) sync(db.upsertReview(u, { ...r, bookId: real(r.bookId) }), "书评");
    },
    removeReview: (id) => {
      const rev = get().myReviews.find((r) => r.id === id);
      set({ myReviews: get().myReviews.filter((r) => r.id !== id) });
      const u = uid();
      if (u && rev) sync(db.removeReview(u, real(rev.bookId)), "书评");
    },
    upsertReview: (r) => {
      const id = real(r.bookId);
      set({ myReviews: [{ ...r, bookId: id }, ...get().myReviews.filter((x) => x.bookId !== id)] });
      const u = uid();
      if (u) sync(db.upsertReview(u, { ...r, bookId: id }), "书评");
    },
    myReviewOf: (bookId) => get().myReviews.find((r) => r.bookId === real(bookId)),
    setMediaProgress: (bookId, pct) => {
      const id = real(bookId);
      set({ mediaProgress: { ...get().mediaProgress, [id]: Math.min(1, Math.max(0, pct)) } });
      syncMedia(id);
    },
    getMediaProgress: (bookId) => get().mediaProgress[real(bookId)] ?? 0,
    setMediaPlayed: (bookId, frac) => {
      const r = real(bookId);
      const prev = get().mediaPlayed[r] ?? 0;
      const next = Math.min(1, Math.max(prev, frac));
      if (next === prev) return;
      set({ mediaPlayed: { ...get().mediaPlayed, [r]: next } });
      syncMedia(r);
    },
    markChapterRead: (bookId, chapterId) => {
      const r = real(bookId);
      const cur = get().readChapters[r] ?? [];
      if (cur.includes(chapterId)) return;
      set({ readChapters: { ...get().readChapters, [r]: [...cur, chapterId] } });
      syncText(r);
    },
    addReadSeconds: (sec) => {
      set({ readSeconds: get().readSeconds + Math.max(0, Math.round(sec)) });
      const u = uid();
      if (u) sync(db.setReadSeconds(u, get().readSeconds), "时长");
    },
  };
});

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
// T2.5 云同步：本地乐观更新 + 登录态写穿透 chat_sessions；登录时云端为主、本地未上云的会话合并上传；退出只清本地、云端永久保留。
interface ChatState {
  sessions: ChatSession[];
  hiddenSamples: string[]; // 被用户删除/清空的示例会话 id（持久化，刷新后不再复现）
  upsertSession: (s: ChatSession) => void;
  removeSession: (id: string) => void;
  clearSessions: () => void;
  hideSample: (id: string) => void;
  hideAllSamples: (ids: string[]) => void;
  loadCloud: (uid: string) => Promise<void>;
  resetLocal: () => void; // 退出登录：仅清本地，不动云端
}
const chatUid = () => useAuth.getState().user?.id;
const chatSync = (q: PromiseLike<{ error: unknown }>) => {
  Promise.resolve(q).then(
    ({ error }) => { if (error) useUI.getState().toast("对话同步失败，已存本机", "error"); },
    () => {}
  );
};
export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      hiddenSamples: [],
      upsertSession: (s) => {
        set({
          sessions: [s, ...get().sessions.filter((x) => x.id !== s.id)].sort(
            (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
          ),
        });
        const u = chatUid();
        if (u) chatSync(chatDb.upsert(u, s));
      },
      removeSession: (id) => {
        set({ sessions: get().sessions.filter((x) => x.id !== id) });
        const u = chatUid();
        if (u) chatSync(chatDb.remove(u, id));
      },
      clearSessions: () => {
        set({ sessions: [] });
        const u = chatUid();
        if (u) chatSync(chatDb.clear(u));
      },
      hideSample: (id) => set({ hiddenSamples: Array.from(new Set([...get().hiddenSamples, id])) }),
      hideAllSamples: (ids) => set({ hiddenSamples: Array.from(new Set([...get().hiddenSamples, ...ids])) }),
      loadCloud: async (uid) => {
        try {
          const cloud = await loadChatSessions(uid);
          const cloudIds = new Set(cloud.map((s) => s.id));
          // 游客期间产生、还没上云的会话：合并展示并补传云端
          const localOnly = get().sessions.filter((s) => !cloudIds.has(s.id));
          for (const s of localOnly) chatSync(chatDb.upsert(uid, s));
          set({ sessions: [...cloud, ...localOnly].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)) });
        } catch {}
      },
      resetLocal: () => set({ sessions: [] }),
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
