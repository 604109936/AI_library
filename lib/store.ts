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
      useChat.getState().purgeForeign(); // 会话失效（token 过期等）：清掉上一账号残留对话，仅保留真·游客会话，防换号串档
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
          const firstSignIn = !get().user; // 该标签页此前未登录（跨标签登录/延迟恢复会话）
          loadProfile(sess.user)
            .then(async (p) => {
              set({ user: p });
              // 必须补 load：否则 user 已置位但本地数据全空，useReadingClock 等会以空基线写穿透洗掉云端（Review P1）
              if (firstSignIn) {
                await useLibrary.getState().load(p);
                await useChat.getState().loadCloud(p.id);
              }
            })
            .catch(() => {});
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
    // avatarUrl 用「键是否存在」判断：传 undefined 表示明确清除云端头像（换回预设），否则永远清不掉
    if ("avatarUrl" in patch) db.avatar_url = patch.avatarUrl ?? null;
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
  // 【hydrated 门禁】未完成 load() 前严禁写穿透：此时本地是空基线，绝对值覆盖会把云端进度/已读章/时长洗掉
  // （登录态下刷新阅读器/乱翻页是最常见触发路径——Review P0）
  const canSync = () => !!uid() && get().hydrated;
  // 文字进度/媒体进度：写库时取当前完整一行（避免分列覆盖）
  const syncText = (bookId: string) => {
    if (!canSync()) return;
    sync(db.setTextProgress(uid()!, bookId, get().progress[bookId], get().readChapters[bookId] ?? []), "进度");
  };
  // 媒体进度同步：5 秒节流（首调即写、其后合并为每 5 秒一次尾写），避免播放时每帧 onTimeUpdate 触发数次/秒的 DB upsert
  const mediaSyncTimer: Record<string, ReturnType<typeof setTimeout>> = {};
  const mediaSyncAt: Record<string, number> = {};
  const syncMedia = (bookId: string) => {
    const u = uid();
    if (!u || !get().hydrated) return;
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
        // 世代校验：加载期间已退出/换号 → 晚到的数据不回写（防串号）
        if (useAuth.getState().user?.id !== user.id) return;
        set({ ...d, hydrated: true });
      } catch {
        set({ hydrated: true });
      }
    },
    reset: () => {
      // 清掉在途的媒体节流定时器：否则退出后旧闭包还会发一次"空数据写库"（被 RLS 拒→莫名报错 toast）
      for (const k of Object.keys(mediaSyncTimer)) { clearTimeout(mediaSyncTimer[k]); delete mediaSyncTimer[k]; }
      for (const k of Object.keys(mediaSyncAt)) delete mediaSyncAt[k];
      set({ ...EMPTY, hydrated: true });
    },
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
    // 书评点赞：写穿透 review_likes（本版 UI 不展示，数据先闭环——原实现纯本地，刷新即丢，与登录加载的云端数据形成鬼影）
    toggleLike: (id) => {
      const has = get().likedReviews.includes(id);
      set({ likedReviews: has ? get().likedReviews.filter((x) => x !== id) : [id, ...get().likedReviews] });
      const u = uid();
      if (u) sync(has ? db.removeReviewLike(u, id) : db.addReviewLike(u, id), "点赞");
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
      const delta = Math.max(0, Math.round(sec));
      if (!delta) return;
      set({ readSeconds: get().readSeconds + delta });
      // 云端走增量 RPC（多设备并行阅读不再互相覆盖丢时长）；未 hydrated 时跳过（防空基线期写入）
      if (canSync()) sync(db.addReadSeconds(delta), "时长");
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
  purgeForeign: () => void; // 清掉非游客残留会话（token 失效路径防串号）
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
        const stamped = { ...s, ownerUid: chatUid() ?? "guest" }; // 标记归属，换号时据此辨别"谁的会话"
        set({
          sessions: [stamped, ...get().sessions.filter((x) => x.id !== s.id)].sort(
            (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
          ),
        });
        const u = chatUid();
        if (u) chatSync(chatDb.upsert(u, stamped));
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
          const cloud = (await loadChatSessions(uid)).map((s) => ({ ...s, ownerUid: uid }));
          // 世代校验：加载期间已退出/换号 → 晚到数据不回写、不上传（防把 A 的会话灌进 B 的账号）
          if (useAuth.getState().user?.id !== uid) return;
          const cloudIds = new Set(cloud.map((s) => s.id));
          // 仅"真·游客会话或本人会话"合并上传；其它账号残留一律丢弃
          const localOnly = get().sessions.filter(
            (s) => !cloudIds.has(s.id) && (!s.ownerUid || s.ownerUid === "guest" || s.ownerUid === uid)
          );
          for (const s of localOnly) chatSync(chatDb.upsert(uid, s));
          set({
            sessions: [...cloud, ...localOnly.map((s) => ({ ...s, ownerUid: uid }))].sort(
              (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)
            ),
          });
        } catch {}
      },
      resetLocal: () => set({ sessions: [] }),
      purgeForeign: () => set({ sessions: get().sessions.filter((s) => !s.ownerUid || s.ownerUid === "guest") }),
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
