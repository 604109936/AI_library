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
import { msgIdTime, DEMO_EMAIL } from "@/lib/utils";
import { loadUserData, loadMainSession, chatDb, db } from "@/lib/supabase/userdata";

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

// 登录后的全量加载链（资料 → 书库数据 → 对话云端）。
// signInWithPassword 会同步广播 SIGNED_IN，login()/register() 与 onAuthStateChange 处理器会双触发——
// 按 uid 合并在途加载保证整链只跑一次：重复跑既双倍打库，也会放大「user 已置位、数据未就绪」的空基线窗口
let signInLoading: { uid: string; p: Promise<void> } | null = null;
function signInLoad(authUser: { id: string }): Promise<void> {
  if (signInLoading?.uid === authUser.id) return signInLoading.p;
  const p = (async () => {
    try {
      const prof = await loadProfile(authUser);
      useAuth.setState({ user: prof });
      await useLibrary.getState().load(prof);
      await useChat.getState().loadCloud(prof.id);
    } finally {
      signInLoading = null;
    }
  })();
  signInLoading = { uid: authUser.id, p };
  return p;
}

interface AuthState {
  user: UserProfile | null;
  hydrated: boolean; // 是否已完成首屏会话恢复
  initAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (email: string, password: string, nickname?: string) => Promise<{ error?: string; needConfirm?: boolean }>;
  logout: () => Promise<void>;
  updateProfile: (patch: Partial<UserProfile>) => Promise<{ error?: string }>;
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
        await signInLoad(data.session.user);
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
          useUI.getState().clearRecent(); // 搜索历史属账号痕迹：登出即清，防换号/游客可见上一账号搜过什么（Review P0）
        } else if (sess?.user && (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED")) {
          if (!get().user) {
            // 该标签页此前未登录（跨标签登录/延迟恢复会话）：走完整加载链。
            // 必须补 load：否则 user 已置位但本地数据全空，useReadingClock 等会以空基线写穿透洗掉云端（Review P1）；
            // 与 login()/register() 的双触发由 signInLoad 在途去重
            signInLoad(sess.user).catch(() => {});
          } else {
            // 已登录态的资料刷新（USER_UPDATED/TOKEN_REFRESHED）：只刷 profile，不重拉数据
            loadProfile(sess.user).then((p) => set({ user: p })).catch(() => {});
          }
        }
      });
    }
  },
  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { error: error.message };
    if (data.user) await signInLoad(data.user);
    return {};
  },
  register: async (email, password, nickname) => {
    // 昵称随 signUp 进 user_metadata：建 profiles 的 handle_new_user 触发器读 raw_user_meta_data 写入。
    // 旧实现 signUp 后直接 update profiles——邮箱确认开启时无会话（anon 角色），RLS 让 update 静默命中
    // 0 行，昵称永久丢失落回邮箱前缀
    const nick = nickname?.trim() || "";
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      ...(nick ? { options: { data: { nickname: nick } } } : {}),
    });
    if (error) return { error: error.message };
    const u = data.user;
    if (!u) return { error: "注册失败，请重试" };
    if (nick && data.session) {
      // 有会话时再直写一次作双保险（老触发器未更新前也能生效）；error 不致命（触发器已写过）
      await supabase.from("profiles").update({ nickname: nick }).eq("id", u.id);
    }
    if (!data.session) return { needConfirm: true }; // 邮箱验证未关闭时无会话
    await signInLoad(u);
    return {};
  },
  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null });
    useLibrary.getState().reset();
    useChat.getState().resetLocal(); // 对话只清本地，云端永久保留
    useUI.getState().clearRecent(); // 搜索历史随登出清空（防跨账号残留）
  },
  updateProfile: async (patch) => {
    const u = get().user;
    if (!u) return { error: "登录已失效" };
    set({ user: { ...u, ...patch } }); // 乐观更新
    const db: Record<string, any> = {};
    if (patch.nickname !== undefined) db.nickname = patch.nickname;
    if (patch.bio !== undefined) db.bio = patch.bio;
    if (patch.avatarSeed !== undefined) db.avatar_seed = patch.avatarSeed;
    // avatarUrl 用「键是否存在」判断：传 undefined 表示明确清除云端头像（换回预设），否则永远清不掉
    if ("avatarUrl" in patch) db.avatar_url = patch.avatarUrl ?? null;
    if (Object.keys(db).length) {
      // 必须检查 error：supabase 写失败不 throw。吞掉会变成"保存假成功"——本地新值/云端旧值永久不一致
      const { error } = await supabase.from("profiles").update(db).eq("id", u.id);
      if (error) { set({ user: u }); return { error: "保存失败" }; } // 回滚乐观值
    }
    return {};
  },
}));

/* ---------------- UI / Theme / Toast / LoginSheet / 搜索历史 ---------------- */
export type Theme = "light" | "dark";
export interface Toast {
  id: number;
  type: "success" | "error" | "info";
  msg: string;
  action?: { label: string; onClick: () => void }; // 可选动作钮（如「撤销」），点击后该 toast 立即消失
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
  toast: (msg: string, type?: Toast["type"], action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
  loginOpen: boolean;
  pending: (() => void) | null;
  openLogin: (pending?: () => void) => void;
  closeLogin: () => void;
}
let toastId = 1;
// 各 toast 的自动消失定时器：同文案重复触发时仅重置计时（B11）
const toastTimers: Record<number, ReturnType<typeof setTimeout>> = {};
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
      toast: (msg, type = "success", action) => {
        const cur = get().toasts;
        const last = cur[cur.length - 1];
        // 队尾同文案去重：不再新增，只重置自动消失计时
        if (last && last.msg === msg && last.type === type) {
          clearTimeout(toastTimers[last.id]);
          toastTimers[last.id] = setTimeout(() => get().dismiss(last.id), 2800);
          return;
        }
        const id = toastId++;
        set({ toasts: [...cur, { id, msg, type, action }].slice(-3) }); // 最多同时 3 条
        // 带动作的 toast 多留一会儿（撤销窗口 4s）
        toastTimers[id] = setTimeout(() => get().dismiss(id), action ? 4000 : 2800);
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
  removeHistory: (bookId: string, mode: ReadingMode) => void;
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
// 历史大类：音视频(video/audio)同属 av，与文字稿 text 分开（与 reading_history.mode_category 同口径）
const histCat = (m: ReadingMode) => (m === "text" ? "text" : "av");
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
      // 进入加载先关写穿透门禁：登录/换号路径下 hydrated 可能仍是上一世代（游客/旧号）的 true，
      // 不归零的话，加载完成前阅读器/播放器的自动上报会以空基线把云端 read_chapter_ids、
      // reading_history 等洗掉（Review P0：reset() 落点 hydrated=true + 游客路径 setHydrated 都会留下残留 true）
      set({ hydrated: false });
      // 失败重试一次；仍失败则保持 hydrated=false——绝不能"假装水合成功"放行写穿透，
      // 空基线会把云端真实进度洗成 0（loadUserData 已逐路检查 error，失败必 throw）
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const d = await loadUserData(user);
          // 世代校验：加载期间已退出/换号 → 晚到的数据不回写（防串号）
          if (useAuth.getState().user?.id !== user.id) return;
          set({ ...d, hydrated: true });
          return;
        } catch {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (useAuth.getState().user?.id !== user.id) return;
      useUI.getState().toast("云端数据没加载出来，进度同步先暂停了——刷新一下试试", "error");
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
      const top = get().history[0];
      if (top && top.bookId === id && histCat(top.mode) === histCat(h.mode) && top.progress === h.progress) return; // 已在最前且进度未变 → 不重复 set/写库
      set({ history: [{ ...h, bookId: id }, ...get().history.filter((x) => !(x.bookId === id && histCat(x.mode) === histCat(h.mode)))].slice(0, 50) });
      // 必须过 canSync（uid + hydrated 双门禁）：pushHistory 由阅读器/播放器挂载自动触发，
      // 登录后 load() 未完成的窗口期上报会用空基线 progress=0 直接覆盖云端 reading_history
      if (canSync()) sync(db.pushHistory(uid()!, id, h.mode, h.progress, h.lastAt), "历史");
    },
    clearHistory: () => {
      set({ history: [] });
      const u = uid();
      if (u) sync(db.clearHistory(u), "历史");
    },
    removeHistory: (bookId, mode) => {
      // 只删同大类（av/text）：避免删音视频记录把同书的文字稿记录一并误删
      const id = real(bookId);
      set({ history: get().history.filter((x) => !(x.bookId === id && histCat(x.mode) === histCat(mode))) });
      const u = uid();
      if (u) sync(db.removeHistory(u, id, mode), "历史");
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
// T4 全局单一会话：每用户唯一一条持续会话流（id='main'），跨设备跨登录连续。
// sessions 数组形态保留（持久化兼容），但恒最多一条 main。本地乐观更新 + 登录态写穿透；
// 登录时云端为主、本地（游客期）多出的消息按 id 去重追加并回传云端；退出只清本地、云端永久保留。
export const MAIN_SESSION_TITLE = "与小涤的对话";
interface ChatState {
  sessions: ChatSession[];
  hiddenSamples: string[]; // 被用户隐藏的欢迎页示例 id（持久化，刷新后不再复现）
  cloudLoaded: string | null; // 已成功拉取过云端 main 的 uid（不持久化）：拉取成功前禁止整段覆盖上云
  upsertSession: (s: ChatSession) => void;
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
let chatCloudLoading: string | null = null; // loadCloud 在途去重（persist 重试 + 登录链可能并发触发）
export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      hiddenSamples: [],
      cloudLoaded: null,
      upsertSession: (s) => {
        const stamped = { ...s, ownerUid: chatUid() ?? "guest" }; // 标记归属，换号时据此辨别"谁的会话"
        set({ sessions: [stamped] }); // 单一会话：永远只有这一条
        const u = chatUid();
        if (!u) return;
        // 【云端门禁——Review P0】chatDb.upsert 是整段 jsonb 覆盖写：云端历史尚未成功拉到本地
        // （loadCloud 失败/未完成）时绝不能上云，否则一条新发言就把几百条历史洗成本地短列表。
        // 改为补拉一次：loadCloud 成功后会把本地新增按 id 并入并自动回传
        if (get().cloudLoaded === u) chatSync(chatDb.upsert(u, stamped));
        else void get().loadCloud(u);
      },
      hideSample: (id) => set({ hiddenSamples: Array.from(new Set([...get().hiddenSamples, id])) }),
      hideAllSamples: (ids) => set({ hiddenSamples: Array.from(new Set([...get().hiddenSamples, ...ids])) }),
      loadCloud: async (uid) => {
        if (chatCloudLoading === uid) return; // 同账号已在拉取中
        chatCloudLoading = uid;
        try {
          // 失败重试一次（与书库 load 同口径）：loadCloud 静默失败曾是"覆盖云端历史"P0 的根源
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const cloud = await loadMainSession(uid);
              // 世代校验：加载期间已退出/换号 → 晚到数据不回写、不上传（防把 A 的会话灌进 B 的账号）
              if (useAuth.getState().user?.id !== uid) return;
              const local = get().sessions.find((s) => s.id === "main");
              // 共享体验账号只读云端（任何设备的本地残留都不上传）；普通账号仅并入"真·游客/本人"的消息，legacy/他人残留丢弃
              const isSharedDemo = useAuth.getState().user?.email === DEMO_EMAIL;
              const localOk = !isSharedDemo && local && (!local.ownerUid || local.ownerUid === "guest" || local.ownerUid === uid);
              const cloudMsgs = cloud?.messages ?? [];
              const seen = new Set(cloudMsgs.map((m) => m.id));
              const extra = localOk ? local!.messages.filter((m) => !seen.has(m.id)) : [];
              // 并集后按消息 id 时间戳稳定排序：游客期较早的本地消息若一律 concat 到云端之后，
              // transcript 会乱序并随 persist 固化喂回模型
              const messages = extra.length
                ? [...cloudMsgs, ...extra].sort((a, b) => msgIdTime(a.id) - msgIdTime(b.id))
                : cloudMsgs;
              if (!messages.length) { set({ sessions: [], cloudLoaded: uid }); return; }
              const merged: ChatSession = {
                id: "main",
                title: MAIN_SESSION_TITLE,
                // 没有本地新增时沿用云端时间，不无故刷新
                updatedAt: extra.length ? new Date().toISOString() : cloud?.updatedAt ?? new Date().toISOString(),
                messages,
                ownerUid: uid,
              };
              if (extra.length) chatSync(chatDb.upsert(uid, merged)); // 游客期攒下的消息回传云端
              set({ sessions: [merged], cloudLoaded: uid });
              return;
            } catch {
              if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
            }
          }
          if (useAuth.getState().user?.id !== uid) return;
          useUI.getState().toast("对话历史没加载出来，新消息先存本机稍后自动同步", "error");
        } finally {
          chatCloudLoading = null;
        }
      },
      resetLocal: () => set({ sessions: [], cloudLoaded: null }),
      purgeForeign: () => set({ sessions: get().sessions.filter((s) => !s.ownerUid || s.ownerUid === "guest") }),
    }),
    {
      name: "ail-chat",
      version: 2,
      // cloudLoaded 是会话期内存标记，绝不能持久化：否则刷新后带着旧 uid 复活，门禁形同虚设
      partialize: (s) => ({ sessions: s.sessions, hiddenSamples: s.hiddenSamples }) as any,
      migrate: (state: any, version: number) => {
        // v1：旧版（ownerUid 字段之前）的存量会话可能属于此前登录过的任意账号——打 legacy 标记防串档上传
        if (version < 1 && Array.isArray(state?.sessions)) {
          state.sessions = state.sessions.map((s: any) => (s.ownerUid ? s : { ...s, ownerUid: "legacy" }));
        }
        // v2（T4 单一会话）：本地多会话按时间升序合并为一条 main；legacy（归属不明）不并入直接丢弃
        if (version < 2 && Array.isArray(state?.sessions) && state.sessions.length) {
          const usable = state.sessions.filter((s: any) => s.ownerUid !== "legacy");
          const sorted = [...usable].sort((a: any, b: any) => +new Date(a.updatedAt) - +new Date(b.updatedAt));
          const msgs = sorted.flatMap((s: any) => (Array.isArray(s.messages) ? s.messages : []));
          const last = sorted[sorted.length - 1];
          state.sessions = msgs.length
            ? [{ id: "main", title: MAIN_SESSION_TITLE, updatedAt: last.updatedAt, messages: msgs, ownerUid: last.ownerUid }]
            : [];
        }
        return state;
      },
    }
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
