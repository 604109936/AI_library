// 数据访问层。
// 目录类读取（首页/分类/详情/章节/搜索/乱翻）已接 Supabase（真实数据，公开读）。
// 智学回复(buildChatReply)/读者评价(getBookReviews)/示例问/热门搜索 暂留 mock，
// 分别待 3.7（minimax Agent）、用户数据阶段、3.8（search_logs 聚合）替换。
import { supabase } from "@/lib/supabase/client";
import {
  books as mockBooks,
  categories as mockCategories,
  chaptersByBook,
  reviewsByBook,
  hotSearches,
  exampleQuestions,
} from "@/lib/mock/data";
import type { Book, Category, Chapter, Citation, Paged, Review } from "@/lib/types";

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
  // 热门好书：按「入库时间」由远到近（已读完的由前端过滤后取 20）
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

// 智学：mock 流式回答 + 引用 + 推荐（3.7 接 minimax Agent 后替换）。
export function buildChatReply(question: string): {
  answer: string;
  citations: Citation[];
  recommendations: Book[];
} {
  const q = question || "";
  const wantRecommend = /推荐|哪些|书单|类似|有没有|想读|读什么/.test(q);

  let target = mockBooks.find((b) => q.includes(b.title));
  if (!target) {
    const cat = mockCategories.find((c) => q.includes(c.name));
    if (cat) target = mockBooks.find((b) => b.categoryId === cat.id);
  }
  if (!target) {
    target = mockBooks.find((b) => b.tags.some((t) => q.includes(t)) || (q.length > 1 && b.summary.includes(q.slice(0, 2))));
  }
  if (!target) target = mockBooks[Math.floor(Math.random() * mockBooks.length)];

  const ch1 = chaptersByBook[target.id]?.[0];
  const answer = wantRecommend
    ? `根据你的问题，我从馆藏里挑了几本很契合的书。\n\n首推 **《${target.title}》**（${target.author}）：${target.summary}\n\n> ${target.summary.slice(0, 40)}……\n\n你可以点下方的推荐书目卡片，直接开始阅读。`
    : `关于「${q || target.title}」，我在馆藏中找到了相关内容。\n\n**《${target.title}》**（${target.author}）谈到：${target.summary}\n\n> 来源：《${target.title}》第${ch1?.no ?? 1}章 ${ch1?.title ?? ""}\n\n如果想深入，点击下方引用卡片可跳到原文对应章节。`;

  const citations: Citation[] = ch1
    ? [
        {
          bookId: target.id,
          bookTitle: target.title,
          coverSeed: target.coverSeed,
          cover: target.cover,
          chapterNo: ch1.no,
          chapterTitle: ch1.title,
          snippet: ch1.content.slice(0, 50).replace(/\n/g, " ") + "…",
        },
      ]
    : [];
  const recommendations = wantRecommend
    ? [target, ...mockBooks.filter((b) => b.id !== target!.id && b.categoryId === target!.categoryId)].slice(0, 5)
    : [];
  return { answer, citations, recommendations };
}

export { exampleQuestions, hotSearches };
