// 数据访问层。
// 目录类读取（首页/分类/详情/章节/搜索/乱翻）已接 Supabase（真实数据，公开读）。
// 读者评价(getBookReviews)暂留 mock（本版数据-only 不展示）；热门搜索过渡期由真实书目动态生成（T3.4 改 search_logs 聚合）。
import { supabase } from "@/lib/supabase/client";
import { reviewsByBook, exampleQuestions } from "@/lib/mock/data";
import type { Book, Category, Chapter, Paged, Review } from "@/lib/types";

const PAGE = 6;

// books 查询统一带上分类名（PostgREST 外键内嵌）
const BOOK_SELECT = "*, category:categories(name)";

// 数据库行 → 前端 Book。封面用 OSS cover_url（空则前端按 coverSeed 兜底）；
// 氛围图/海报按分类现算（静态装饰图，不入库）；tags 前插分类名（沿用前端口径）。
function toBook(row: any): Book {
  const catName: string = row.category?.name ?? "";
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? "",
    cover: row.cover_url ?? "",
    coverSeed: row.cover_seed ?? 1,
    heroUrl: `/heroes/${row.category_id}.webp`,
    posterUrl: `/posters/${row.category_id}.webp`,
    category: catName,
    categoryId: row.category_id,
    tags: [catName, ...(Array.isArray(row.tags) ? row.tags : [])].filter(Boolean),
    summary: row.summary ?? "",
    rating: Number(row.rating ?? 0),
    readers: row.readers ?? 0,
    words: row.words ?? 0,
    durationMin: row.duration_min ?? 0,
    hasVideo: !!row.has_video,
    hasAudio: !!row.has_audio,
    hasText: !!row.has_text,
    videoUrl: row.video_url ?? undefined,
    audioUrl: row.audio_url ?? undefined,
    likes: row.fav_count ?? 0, // likes 为历史冗余字段；映射到收藏数避免 NaN
    favCount: row.fav_count ?? 0,
    reviewCount: row.review_count ?? 0,
    featured: !!row.featured,
    intro: row.intro ?? "",
    shelvedAt: row.shelved_at,
  };
}

// 数据库行 → 前端 Chapter。已读态属用户数据（由 text_progress 派生），此处不带 status。
function toChapter(row: any): Chapter {
  return {
    id: row.id,
    bookId: row.book_id,
    no: row.no,
    title: row.title,
    content: row.content ?? "",
    audioStart: row.audio_start ?? 0,
  };
}

// 按分类统计书数
function countByCategory(rows: { category_id: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.category_id] = (counts[r.category_id] ?? 0) + 1;
  return counts;
}

export async function getHome(): Promise<{
  banners: Book[];
  categories: Category[];
  recommend: Book[];
}> {
  const [catRes, bookRes] = await Promise.all([
    supabase.from("categories").select("*").order("sort_order"),
    supabase.from("books").select(BOOK_SELECT).order("shelved_at", { ascending: false }),
  ]);
  if (catRes.error) throw catRes.error;
  if (bookRes.error) throw bookRes.error;

  const allBooks = (bookRes.data ?? []).map(toBook);
  const counts = countByCategory((bookRes.data ?? []) as { category_id: string }[]);
  const categories: Category[] = (catRes.data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    count: counts[c.id] ?? 0,
  }));
  // Banner：每个分类「最新入库」的一本（books 已按 shelved_at desc，取每类第一本）
  const banners = categories
    .map((c) => allBooks.find((b) => b.categoryId === c.id))
    .filter((b): b is Book => !!b);
  // 热门好书：按「入库时间」最早→最近（2026-06-12 用户终裁，文档同步更新；不用 created_at）；已读完的由前端过滤后取 20
  const recommend = [...allBooks].sort((a, b) => +new Date(a.shelvedAt) - +new Date(b.shelvedAt));
  return { banners, categories, recommend };
}

export async function getCategories(): Promise<Category[]> {
  const [catRes, bookRes] = await Promise.all([
    supabase.from("categories").select("*").order("sort_order"),
    supabase.from("books").select("category_id"),
  ]);
  if (catRes.error) throw catRes.error;
  if (bookRes.error) throw bookRes.error;
  const counts = countByCategory((bookRes.data ?? []) as { category_id: string }[]);
  return (catRes.data ?? []).map((c: any) => ({ id: c.id, name: c.name, icon: c.icon, count: counts[c.id] ?? 0 }));
}

export async function getBooks(opts: {
  categoryId?: string;
  readingType?: "av" | "text"; // 阅读类型：音视频 / 文字稿
  cursor?: number;
}): Promise<Paged<Book>> {
  const cursor = opts.cursor ?? 0;
  let q = supabase.from("books").select(BOOK_SELECT, { count: "exact" }).order("shelved_at", { ascending: false });
  if (opts.categoryId) q = q.eq("category_id", opts.categoryId);
  if (opts.readingType === "av") q = q.or("has_video.eq.true,has_audio.eq.true");
  else if (opts.readingType === "text") q = q.eq("has_text", true);
  const { data, count, error } = await q.range(cursor, cursor + PAGE - 1);
  if (error) throw error;
  const items = (data ?? []).map(toBook);
  const total = count ?? 0;
  const next = cursor + PAGE;
  const hasMore = next < total;
  return { items, nextCursor: hasMore ? next : null, hasMore };
}

export async function getBook(id: string): Promise<Book | null> {
  const real = id.split("__")[0];
  const { data, error } = await supabase.from("books").select(BOOK_SELECT).eq("id", real).maybeSingle();
  if (error) throw error;
  return data ? toBook(data) : null;
}

// 按 id 批量取书（收藏页：把收藏的 book_id 列表解析成书）
export async function getBooksByIds(ids: string[]): Promise<Book[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase.from("books").select(BOOK_SELECT).in("id", ids);
  if (error) throw error;
  return (data ?? []).map(toBook);
}

export async function getChapters(bookId: string): Promise<Chapter[]> {
  const real = bookId.split("__")[0];
  const { data, error } = await supabase.from("chapters").select("*").eq("book_id", real).order("no");
  if (error) throw error;
  return (data ?? []).map(toChapter);
}

export async function getChapter(bookId: string, chapterId: string): Promise<Chapter | null> {
  // 必须校验章节确属此书：否则拼错的深链会静默取到别本书的正文，进而把进度/笔记写错书
  const { data, error } = await supabase.from("chapters").select("*").eq("id", chapterId).eq("book_id", bookId.split("__")[0]).maybeSingle();
  if (error) throw error;
  return data ? toChapter(data) : null;
}

export async function getFlip(seenIds: string[]): Promise<Book[]> {
  // 乱翻：有视频的书池（个性化 flip_feed 在 3.8）。当前=取全部有视频书，洗牌分批下滑。
  const { data, error } = await supabase.from("books").select(BOOK_SELECT).eq("has_video", true);
  if (error) throw error;
  const videoBooks = (data ?? []).map(toBook);
  if (videoBooks.length === 0) return [];
  const round = Math.floor(seenIds.length / Math.max(1, videoBooks.length));
  const shuffled = [...videoBooks].sort(() => Math.random() - 0.5);
  // 复制本批并赋唯一 id 后缀，避免无限滚动时 key 冲突
  return shuffled.map((b) => (round === 0 && seenIds.length === 0 ? b : { ...b, id: `${b.id}__f${seenIds.length}_${b.coverSeed}` }));
}

export interface SearchResult {
  books: Book[];
}
export async function search(q: string): Promise<SearchResult> {
  // 仅按 书名 / 作者 / 标签 模糊匹配。当前取全部书前端过滤（与 mock 行为一致，含标签子串）；
  // 数据量增大后改服务端 ilike + tags GIN/trgm（见建库 SQL「按需索引」）。
  const kw = q.trim();
  if (!kw) return { books: [] };
  const { data, error } = await supabase.from("books").select(BOOK_SELECT);
  if (error) throw error;
  const all = (data ?? []).map(toBook);
  const bk = all.filter(
    (b) => b.title.includes(kw) || b.author.includes(kw) || b.tags.some((t) => t.includes(kw))
  );
  return { books: bk };
}

// ---- 以下暂留 mock，待后续阶段替换 ----

export async function getBookReviews(bookId: string, sort: "hot" | "new"): Promise<Review[]> {
  // 读者评价（他人书评）本版数据-only、不前端展示；保留 mock 备用，接用户数据阶段改 Supabase。
  const real = bookId.split("__")[0];
  const list = (reviewsByBook[real] ?? []).slice();
  if (sort === "hot") list.sort((a, b) => b.likes - a.likes);
  else list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return list;
}

// 热门搜索（过渡版）：由真实书库动态生成（书名 + 高频标签），保证每个词点出去都有结果；
// T3.4 接 search_logs 全站聚合 Top20 后替换，函数签名不变。
let hotCache: { words: string[]; at: number } | null = null;
export async function getHotSearches(): Promise<string[]> {
  if (hotCache && Date.now() - hotCache.at < 10 * 60 * 1000) return hotCache.words;
  const { data, error } = await supabase.from("books").select("title, tags").order("shelved_at", { ascending: false }).limit(30);
  if (error) throw error;
  const titles = (data ?? []).map((b: any) => String(b.title)).slice(0, 8);
  const tagCount = new Map<string, number>();
  for (const b of data ?? []) for (const t of (b.tags ?? []) as string[]) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const words = Array.from(new Set([...titles, ...tags])).slice(0, 12);
  hotCache = { words, at: Date.now() };
  return words;
}

export { exampleQuestions };
