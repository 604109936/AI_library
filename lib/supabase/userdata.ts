// 用户数据访问层（3.5）：登录后加载本人数据 + 各操作写穿透。
// 纯 DB 函数（只 import supabase client，不 import store，避免循环依赖）。
// 注意：用户表的 book_id/chapter_id 故意不设外键（解耦），所以不能用 PostgREST 内嵌，
//       需先取用户行、再按 id 批量查 books/chapters，在 JS 里拼装展示字段。
import { supabase } from "@/lib/supabase/client";
import type { ChatSession, HistoryItem, NoteItem, Progress, ReadingMode, Review } from "@/lib/types";

export interface UserDataSlices {
  favorites: string[];
  notes: NoteItem[];
  myReviews: Review[];
  history: HistoryItem[];
  progress: Record<string, Progress>;
  readChapters: Record<string, string[]>;
  mediaProgress: Record<string, number>;
  mediaPlayed: Record<string, number>;
  mediaCovered: Record<string, [number, number][]>;
  readSeconds: number;
  likedReviews: string[];
}

const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

// 一次性加载本人全部数据
export async function loadUserData(user: { id: string; nickname: string; avatarSeed: number }): Promise<UserDataSlices> {
  const uid = user.id;
  // 第一波：本人各表
  const [favR, noteR, revR, histR, tpR, mpR, profR, likeR] = await Promise.all([
    supabase.from("favorites").select("book_id, created_at").eq("user_id", uid).order("created_at", { ascending: false }),
    supabase.from("notes").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    supabase.from("reviews").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    supabase.from("reading_history").select("*").eq("user_id", uid).order("last_at", { ascending: false }),
    supabase.from("text_progress").select("*").eq("user_id", uid),
    supabase.from("media_progress").select("*").eq("user_id", uid),
    supabase.from("profiles").select("read_seconds").eq("id", uid).maybeSingle(),
    supabase.from("review_likes").select("review_id").eq("user_id", uid),
  ]);
  // 任何一路失败必须抛错：supabase-js 失败不 reject 而是 resolve {error}，静默吞掉会变成
  // 「空基线 + hydrated=true」——写穿透门禁被合法打开，空数据反向洗掉云端真实进度
  const failed = [favR, noteR, revR, histR, tpR, mpR, profR, likeR].find((r) => (r as { error?: unknown }).error);
  if (failed) throw new Error(`用户数据加载失败：${String((failed as { error?: { message?: string } }).error?.message ?? "未知错误")}`);

  const noteRows = (noteR.data ?? []) as any[];
  const revRows = (revR.data ?? []) as any[];
  const histRows = (histR.data ?? []) as any[];

  // 第二波：按需批量查 books / chapters（用于拼书名/封面/章标题）
  const bookIds = uniq([...noteRows, ...revRows, ...histRows].map((r) => r.book_id));
  const chapIds = uniq(noteRows.map((r) => r.chapter_id));
  const [booksR, chapsR] = await Promise.all([
    bookIds.length
      ? supabase.from("books").select("id,title,author,cover_url,cover_seed").in("id", bookIds)
      : Promise.resolve({ data: [] as any[] }),
    chapIds.length
      ? supabase.from("chapters").select("id,title").in("id", chapIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const failed2 = [booksR, chapsR].find((r) => (r as { error?: unknown }).error);
  if (failed2) throw new Error(`用户数据加载失败：${String((failed2 as { error?: { message?: string } }).error?.message ?? "未知错误")}`);
  const bookMap = new Map((booksR.data ?? []).map((b: any) => [b.id, b]));
  const chapMap = new Map((chapsR.data ?? []).map((c: any) => [c.id, c]));

  const favorites = (favR.data ?? []).map((r: any) => r.book_id);

  const notes: NoteItem[] = noteRows.map((r) => {
    const b = bookMap.get(r.book_id);
    return {
      id: r.id,
      bookId: r.book_id,
      bookTitle: b?.title ?? "",
      bookCoverSeed: b?.cover_seed ?? 1,
      chapterId: r.chapter_id,
      chapterTitle: chapMap.get(r.chapter_id)?.title ?? "",
      excerpt: r.excerpt ?? "",
      note: r.note ?? "",
      color: r.color ?? "",
      start: r.start_offset ?? undefined,
      end: r.end_offset ?? undefined,
      createdAt: r.created_at,
    };
  });

  const myReviews: Review[] = revRows.map((r) => {
    const b = bookMap.get(r.book_id);
    return {
      id: r.id,
      bookId: r.book_id,
      bookTitle: b?.title,
      bookCover: b?.cover_url ?? undefined,
      bookCoverSeed: b?.cover_seed ?? 1,
      userId: uid,
      nickname: user.nickname,
      avatarSeed: user.avatarSeed,
      rating: Number(r.rating),
      title: r.title ?? undefined,
      content: r.content ?? "",
      likes: r.likes ?? 0,
      createdAt: r.created_at,
      mine: true,
    };
  });

  const history: HistoryItem[] = histRows.map((r) => {
    const b = bookMap.get(r.book_id);
    return {
      bookId: r.book_id,
      bookTitle: b?.title ?? "",
      author: b?.author ?? undefined,
      coverSeed: b?.cover_seed ?? 1,
      cover: b?.cover_url ?? undefined,
      // 入库存的是大类 av/text；前端 mode 用 video 代表 av（历史只区分 音视频/文字）
      mode: (r.mode_category === "text" ? "text" : "video") as ReadingMode,
      progress: r.progress ?? 0,
      lastAt: r.last_at,
    };
  });

  const progress: Record<string, Progress> = {};
  const readChapters: Record<string, string[]> = {};
  for (const r of (tpR.data ?? []) as any[]) {
    if (r.last_chapter_id) {
      progress[r.book_id] = { bookId: r.book_id, chapterId: r.last_chapter_id, chapterNo: r.last_chapter_no ?? 1, pct: r.pct ?? 0, mode: "text" };
    }
    readChapters[r.book_id] = r.read_chapter_ids ?? [];
  }

  const mediaProgress: Record<string, number> = {};
  const mediaPlayed: Record<string, number> = {};
  const mediaCovered: Record<string, [number, number][]> = {};
  for (const r of (mpR.data ?? []) as any[]) {
    mediaProgress[r.book_id] = Number(r.position) || 0;
    const cov = Array.isArray(r.covered) ? (r.covered as [number, number][]) : [];
    mediaCovered[r.book_id] = cov;
    // played 由 covered 区间并集派生（旧脏数据 covered 为空 → played=0，自动纠正之前虚高的"已读完"）
    mediaPlayed[r.book_id] = cov.length ? Math.min(1, cov.reduce((s, x) => s + (Number(x[1]) - Number(x[0])), 0)) : 0;
  }

  const readSeconds = (profR.data as any)?.read_seconds ?? 0;
  const likedReviews = (likeR.data ?? []).map((r: any) => r.review_id);

  return { favorites, notes, myReviews, history, progress, readChapters, mediaProgress, mediaPlayed, mediaCovered, readSeconds, likedReviews };
}

const catOf = (m: ReadingMode) => (m === "text" ? "text" : "av");

/* ---------------- 智学对话云同步（T2.5；T4 起每用户唯一会话 'main'） ---------------- */
// messages 整段存 jsonb（含卡片/反馈），简单可靠；流式中间态字段（streaming/toolNote）入库前剥掉
const cleanMsgs = (msgs: ChatSession["messages"]) =>
  msgs.filter((m) => !m.streaming && !m.voicePending).map(({ streaming, toolNote, voicePending, ...keep }) => keep);

// 拉取本人唯一会话（T4 后云端每用户只有 id='main' 一行）
export async function loadMainSession(uid: string): Promise<ChatSession | null> {
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id,title,updated_at,messages")
    .eq("user_id", uid)
    .eq("id", "main")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: "main", title: data.title ?? "", updatedAt: data.updated_at, messages: Array.isArray(data.messages) ? data.messages : [] };
}

export const chatDb = {
  upsert: (uid: string, s: ChatSession) =>
    supabase.from("chat_sessions").upsert(
      { user_id: uid, id: s.id, title: s.title, messages: cleanMsgs(s.messages), updated_at: s.updatedAt },
      { onConflict: "user_id,id" }
    ),
};

// T1.5「一次阅读」上报：books.read_count +1（不去重，游客也计入）。
// fire-and-forget：RPC 为 SECURITY DEFINER，失败静默（计数列不展示，不值得打扰用户）
export function bumpReadCount(bookId: string) {
  supabase.rpc("increment_read_count", { p_book_id: bookId }).then(
    () => {},
    () => {}
  );
}

// 写穿透：均返回 Supabase 查询（store 侧 .then 处理出错提示）
export const db = {
  // upsert+忽略重复：双标签页/双设备同时收藏同一本书时，第二次 insert 撞主键会报"收藏同步失败"假错
  // （云端实际已是用户想要的状态）；removeFav 删 0 行无错天然幂等
  addFav: (uid: string, bookId: string) =>
    supabase.from("favorites").upsert({ user_id: uid, book_id: bookId }, { onConflict: "user_id,book_id", ignoreDuplicates: true }),
  removeFav: (uid: string, bookId: string) => supabase.from("favorites").delete().eq("user_id", uid).eq("book_id", bookId),

  addNote: (uid: string, n: NoteItem) =>
    supabase.from("notes").insert({
      id: n.id, user_id: uid, book_id: n.bookId, chapter_id: n.chapterId,
      excerpt: n.excerpt ?? "", note: n.note ?? "", color: n.color ?? "",
      // 偏移量强制整数（防 Range 计算出非整数导致 int 列写入失败）
      start_offset: typeof n.start === "number" ? Math.trunc(n.start) : null,
      end_offset: typeof n.end === "number" ? Math.trunc(n.end) : null,
    }),
  removeNote: (id: string) => supabase.from("notes").delete().eq("id", id),
  updateNote: (id: string, note: string) => supabase.from("notes").update({ note }).eq("id", id),

  upsertReview: (uid: string, r: Review) =>
    supabase.from("reviews").upsert(
      { user_id: uid, book_id: r.bookId, rating: r.rating, title: r.title ?? null, content: r.content },
      { onConflict: "user_id,book_id" }
    ),
  removeReview: (uid: string, bookId: string) => supabase.from("reviews").delete().eq("user_id", uid).eq("book_id", bookId),

  pushHistory: (uid: string, bookId: string, mode: ReadingMode, progress: number, lastAt: string) =>
    supabase.from("reading_history").upsert(
      { user_id: uid, book_id: bookId, mode_category: catOf(mode), progress, last_at: lastAt },
      { onConflict: "user_id,book_id,mode_category" }
    ),
  clearHistory: (uid: string) => supabase.from("reading_history").delete().eq("user_id", uid),
  removeHistory: (uid: string, bookId: string, mode: ReadingMode) =>
    supabase.from("reading_history").delete().eq("user_id", uid).eq("book_id", bookId).eq("mode_category", catOf(mode)),

  setTextProgress: (uid: string, bookId: string, p: Progress | undefined, readIds: string[]) =>
    supabase.from("text_progress").upsert(
      { user_id: uid, book_id: bookId, last_chapter_id: p?.chapterId ?? null, last_chapter_no: p?.chapterNo ?? null, pct: p?.pct ?? 0, read_chapter_ids: readIds },
      { onConflict: "user_id,book_id" }
    ),
  setMediaProgress: (uid: string, bookId: string, position: number, played: number, covered: [number, number][] = []) =>
    supabase.from("media_progress").upsert(
      { user_id: uid, book_id: bookId, position, played, covered },
      { onConflict: "user_id,book_id" }
    ),
  // 书评点赞（本版 UI 不展示，数据闭环备将来）
  addReviewLike: (uid: string, reviewId: string) =>
    // 与 addFav 同口径用 upsert+忽略重复：双标签/双端同点同一书评撞主键不再报「点赞同步失败」假错并回滚
    supabase.from("review_likes").upsert({ user_id: uid, review_id: reviewId }, { onConflict: "user_id,review_id", ignoreDuplicates: true }),
  removeReviewLike: (uid: string, reviewId: string) => supabase.from("review_likes").delete().eq("user_id", uid).eq("review_id", reviewId),

  // 时长走服务端增量累加 RPC（add_read_seconds，见 docs/后端_Review修复SQL.md）：
  // 绝对值覆盖在多设备并行阅读时会互相吃掉增量（lost update），增量累加天然无冲突
  addReadSeconds: (delta: number) => supabase.rpc("add_read_seconds", { p_delta: delta }),
};
