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
    banners: books.filter((b) => b.featured),
    categories,
    recommend: [...books].sort((a, b) => b.readers - a.readers).slice(0, 12),
  };
}

export async function getCategories(): Promise<Category[]> {
  await sleep(100);
  return categories;
}

export async function getBooks(opts: {
  categoryId?: string;
  sort?: "new" | "rating" | "readers";
  cursor?: number;
}): Promise<Paged<Book>> {
  // GET /api/books?category=&sort=&cursor=
  await sleep(350);
  let list = books.slice();
  if (opts.categoryId) list = list.filter((b) => b.categoryId === opts.categoryId);
  switch (opts.sort) {
    case "rating":
      list.sort((a, b) => b.rating - a.rating);
      break;
    case "readers":
      list.sort((a, b) => b.readers - a.readers);
      break;
    default:
      break; // new = 原序
  }
  // 真实分页：按真实藏书数自然收口（不再三连复制，避免同书重复 + 数量虚高）
  const cursor = opts.cursor ?? 0;
  const items = list.slice(cursor, cursor + PAGE); // id 天然唯一，无需后缀
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
  // GET /api/books/[id]/chapters/[chapterId]（正文真实来源：火山 Viking）
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
  chapters: { book: Book; chapter: Chapter }[];
}
export async function search(q: string): Promise<SearchResult> {
  // GET /api/search?q=
  await sleep(250);
  if (!q.trim()) return { books: [], chapters: [] };
  const kw = q.trim();
  const bk = books.filter(
    (b) => b.title.includes(kw) || b.author.includes(kw) || b.tags.some((t) => t.includes(kw))
  );
  const chs: { book: Book; chapter: Chapter }[] = [];
  for (const b of books) {
    for (const c of chaptersByBook[b.id] ?? []) {
      if (c.title.includes(kw)) chs.push({ book: b, chapter: c });
    }
  }
  return { books: bk, chapters: chs.slice(0, 6) };
}

export async function getFlip(seenIds: string[]): Promise<Book[]> {
  // GET /api/flip（有视频书池 个性化打分；mock=确定性洗牌后分批，支持持续下滑）
  await sleep(200);
  const videoBooks = books.filter((b) => b.hasVideo);
  const round = Math.floor(seenIds.length / Math.max(1, videoBooks.length));
  // 确定性洗牌：按 (coverSeed, round) 派生的稳定权重排序，避免 Math.random 非幂等
  // 导致 StrictMode 双调用 / 返回该页重排丢数据。
  const shuffled = [...videoBooks].sort(
    (a, b) =>
      ((a.coverSeed * 9301 + round * 49297) % 233280) -
      ((b.coverSeed * 9301 + round * 49297) % 233280)
  );
  // 首批用原 id；后续批次赋唯一 id 后缀，避免无限滚动时 key 冲突
  return shuffled.map((b) =>
    round === 0 && seenIds.length === 0 ? b : { ...b, id: `${b.id}__f${seenIds.length}_${b.coverSeed}` }
  );
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
          chapterId: ch1.id,
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
