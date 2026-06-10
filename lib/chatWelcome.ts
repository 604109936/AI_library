// 智学欢迎区个性化（UI Review B1/B2/B5）：时段问候 + 按读者数据动态生成示例问题。
// 全部纯前端拼装（0 token、0 额外请求）：个人数据来自本地 store，书名来自已缓存的馆藏列表。
// 铁律：示例问题里出现的书必须真实在馆（写死书名的老 mock 因《终身成长》等不在馆，点击即尴尬）。
import type { Book, Category, HistoryItem, NoteItem, Progress } from "@/lib/types";

// 按时段问候：第一眼的"被认出"仪式感
export function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return "早上好";
  if (h >= 11 && h < 14) return "中午好";
  if (h >= 14 && h < 18) return "下午好";
  if (h >= 23 || h < 5) return "夜深了";
  return "晚上好";
}

// 不点名具体书的保底问题：馆藏怎么变都不会落空
const GENERIC = [
  "推荐一本适合我现在读的书",
  "馆里都有哪些类型的书",
  "怎么挑到一本我能读完的书",
  "给我一句今天的读书灵感",
];

export interface PersonalData {
  history: HistoryItem[];
  progress: Record<string, Progress>;
  favorites: string[];
  notes: NoteItem[];
  books: Book[]; // 全馆书目（getHome().recommend 即全量），用于把收藏 id 解析成书名
}

// 登录读者：按「在读 > 刚读完 > 收藏未开读 > 有笔记」优先级生成专属问题，不足补通用
export function buildQuestions(d: PersonalData | null): string[] {
  if (!d) return GENERIC;
  const out: string[] = [];
  const titleOf = new Map(d.books.map((b) => [b.id, b.title]));

  const reading = d.history.find((h) => h.progress > 0 && h.progress < 100);
  if (reading) {
    const ch = d.progress[reading.bookId]?.chapterNo;
    out.push(
      ch && ch > 1
        ? `《${reading.bookTitle}》我读到第 ${ch} 章了，帮我回顾一下前面讲了什么`
        : `《${reading.bookTitle}》我刚开始读，先帮我画个重点`
    );
  }
  const done = d.history.find((h) => h.progress >= 100);
  if (done) out.push(`我读完《${done.bookTitle}》了，接下来读哪本好`);

  const touched = new Set(d.history.map((h) => h.bookId));
  const favFresh = d.favorites.find((id) => !touched.has(id) && titleOf.has(id));
  if (favFresh) out.push(`我收藏的《${titleOf.get(favFresh)}》适合现在开始读吗`);

  const noted = d.notes.find((n) => n.bookTitle);
  if (noted && out.length < 4) out.push(`结合我做过的笔记，帮我把《${noted.bookTitle}》串成一条主线`);

  for (const g of GENERIC) {
    if (out.length >= 4) break;
    if (!out.includes(g)) out.push(g);
  }
  return out.slice(0, 4);
}

// 游客：从真实馆藏拼问题（点出去必有答案）
export function buildGuestQuestions(books: Book[], categories: Category[]): string[] {
  if (!books.length) return GENERIC;
  const out = [
    "推荐一本适合我现在读的书",
    books[0] ? `《${books[0].title}》讲了什么` : "",
    categories[0]?.name ? `馆里有哪些「${categories[0].name}」的书` : "",
    books[1] ? `《${books[1].title}》值得读吗` : "",
  ].filter(Boolean);
  for (const g of GENERIC) {
    if (out.length >= 4) break;
    if (!out.includes(g)) out.push(g);
  }
  return out.slice(0, 4);
}
