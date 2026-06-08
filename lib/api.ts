// 前端 Mock 数据访问层。每个函数对应一个后端 endpoint（注释标注），
// 后端就绪后把实现替换为 fetch('/api/...') 即可，签名不变。
import {
  books,
  categories,
  chaptersByBook,
  reviewsByBook,
  hotSearches,
  exampleQuestions,
} from "@/lib/mock/data";
import type { Book, Category, Chapter, Citation, Paged, Review } from "@/lib/types";
import { sleep } from "@/lib/utils";

const PAGE = 6;

export async function getHome(): Promise<{
  banners: Book[];
  categories: Category[];
  recommend: Book[];
}> {
  // GET /api/home
  await sleep(300);
  return {
    // Banner：每个分类「最新入库」的一本（共 6 本，按分类顺序）
    banners: categories
      .map(
        (c) =>
          books
            .filter((b) => b.categoryId === c.id)
            .sort((a, b) => +new Date(b.shelvedAt) - +new Date(a.shelvedAt))[0]
      )
      .filter(Boolean) as Book[],
    categories,
    // 热门好书：按「创作时间」由远到近排序；已读完的由前端过滤（后端就绪后改为后端排除已读后取 20）
    recommend: [...books].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
  };
}

export async function getCategories(): Promise<Category[]> {
  await sleep(100);
  return categories;
}

export async function getBooks(opts: {
  categoryId?: string;
  readingType?: "av" | "text"; // 阅读类型：音视频 / 文字稿
  cursor?: number;
}): Promise<Paged<Book>> {
  // GET /api/books?category=&type=&cursor=
  await sleep(350);
  let list = books.slice();
  if (opts.categoryId) list = list.filter((b) => b.categoryId === opts.categoryId);
  if (opts.readingType === "av") list = list.filter((b) => b.hasVideo || b.hasAudio);
  else if (opts.readingType === "text") list = list.filter((b) => b.hasText);
  // 默认按「入库时间」倒序（最近入库在前）
  list.sort((a, b) => +new Date(b.shelvedAt) - +new Date(a.shelvedAt));
  // 真实分页（不再复制扩充，避免同一本书重复出现）
  const cursor = opts.cursor ?? 0;
  const items = list.slice(cursor, cursor + PAGE);
  const next = cursor + PAGE;
  return { items, nextCursor: next < list.length ? next : null, hasMore: next < list.length };
}

export async function getBook(id: string): Promise<Book | null> {
  // GET /api/books/[id]
  await sleep(250);
  const real = id.split("__")[0];
  return books.find((b) => b.id === real) ?? null;
}

export async function getChapters(bookId: string): Promise<Chapter[]> {
  // GET /api/books/[id]/chapters
  await sleep(200);
  const real = bookId.split("__")[0];
  return chaptersByBook[real] ?? [];
}

export async function getChapter(bookId: string, chapterId: string): Promise<Chapter | null> {
  // GET /api/books/[id]/chapters/[chapterId]
  await sleep(200);
  const real = bookId.split("__")[0];
  return (chaptersByBook[real] ?? []).find((c) => c.id === chapterId) ?? null;
}

export async function getBookReviews(bookId: string, sort: "hot" | "new"): Promise<Review[]> {
  // GET /api/books/[id]/reviews?sort=
  await sleep(250);
  const real = bookId.split("__")[0];
  const list = (reviewsByBook[real] ?? []).slice();
  if (sort === "hot") list.sort((a, b) => b.likes - a.likes);
  else list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return list;
}

export interface SearchResult {
  books: Book[];
}
export async function search(q: string): Promise<SearchResult> {
  // GET /api/search?q=（仅按 书名 / 作者 / 标签 模糊匹配，仅返回书籍列表）
  await sleep(250);
  if (!q.trim()) return { books: [] };
  const kw = q.trim();
  const bk = books.filter(
    (b) => b.title.includes(kw) || b.author.includes(kw) || b.tags.some((t) => t.includes(kw))
  );
  return { books: bk };
}

export async function getFlip(seenIds: string[]): Promise<Book[]> {
  // GET /api/flip（有视频书池 个性化打分；mock=洗牌后分批，支持持续下滑）
  await sleep(200);
  const videoBooks = books.filter((b) => b.hasVideo);
  const round = Math.floor(seenIds.length / Math.max(1, videoBooks.length));
  const shuffled = [...videoBooks].sort(() => Math.random() - 0.5);
  // 复制本批并赋唯一 id 后缀，避免无限滚动时 key 冲突
  return shuffled.map((b) => (round === 0 && seenIds.length === 0 ? b : { ...b, id: `${b.id}__f${seenIds.length}_${b.coverSeed}` }));
}

// 智学：mock 流式回答 + 引用 + 推荐
export function buildChatReply(question: string): {
  answer: string;
  citations: Citation[];
  recommendations: Book[];
} {
  const q = question || "";
  const wantRecommend = /推荐|哪些|书单|类似|有没有|想读|读什么/.test(q);

  // 命中优先级：书名 > 分类名 > 标签/简介关键词 > 随机（保证不总是同一本）
  let target = books.find((b) => q.includes(b.title));
  if (!target) {
    const cat = categories.find((c) => q.includes(c.name));
    if (cat) target = books.find((b) => b.categoryId === cat.id);
  }
  if (!target) {
    target = books.find((b) => b.tags.some((t) => q.includes(t)) || (q.length > 1 && b.summary.includes(q.slice(0, 2))));
  }
  if (!target) target = books[Math.floor(Math.random() * books.length)];

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
    ? [target, ...books.filter((b) => b.id !== target.id && b.categoryId === target.categoryId)].slice(0, 5)
    : [];
  return { answer, citations, recommendations };
}

export { exampleQuestions, hotSearches };
