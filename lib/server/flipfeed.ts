// T3.1 乱翻日更生成器：每天为每位读者生成 ≤50 本「猜你想读」写入 flip_feed。
// 规则：排除已读完 → 在读优先置顶 → 其余候选交给 minimax 按读者画像（收藏/已读/笔记/书评/对话偏好）排序。
// 兜底链：LLM 失败 → 候选按最新入库序；无任何个人数据的新用户 → 不写行（getFlip 读不到时回退最新入库 50 本）。
// 工程纪律（Review 修复）：
//   ① 所有正确性查询分页拉全（PostgREST 默认 1000 行静默截断，会让"已读完"集不完整 → 违反产品规则）
//   ② 按批生成、按批落库 + 时间预算：超时被掐时已完成批次保留，下次调用真正从断点续做
//   ③ 画像信号按用户批 in() 查询，重度用户不会挤占别人的全局配额
import "server-only";
import { admin } from "@/lib/server/agent";
import { chatOnce } from "@/lib/server/minimax";

// 排序走便宜快的模型（与压缩同款思路）；要换模型只需在 .env.local 设 MINIMAX_FEED_MODEL
const FEED_MODEL = process.env.MINIMAX_FEED_MODEL || "MiniMax-Text-01";
const FEED_SIZE = 50;
const USER_BATCH = 24;      // 每批处理的用户数（信号查询 + LLM + 落库 以批为单位）
const CONCURRENCY = 4;      // 批内同时跑几个 LLM 排序（防 MiniMax 限流）
const CANDIDATE_CAP = 120;  // 送 LLM 的候选上限：feed 才 50 本，120 个最新候选绰绰有余，防 token 截断打穿解析
const TIME_BUDGET_MS = 50_000; // 生成预算（route maxDuration=60s，留 10s 余量收尾返回）

// 北京时区的「今天」（Vercel 跑在 UTC，直接 toISOString 会差 8 小时跨错天）
export const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

interface Candidate { id: string; title: string; tags: string[]; digest: string }
interface UserSignal {
  done: Set<string>;     // 已读完（排除）
  reading: Set<string>;  // 在读（置顶）
  favs: string[];        // 收藏 book_id
  notes: string[];       // 最近笔记摘录
  reviews: string[];     // 书评要点
  chats: string[];       // 最近对话偏好（用户消息 + 压缩摘要）
}
const hasSignal = (s: UserSignal | undefined): s is UserSignal =>
  !!s && (s.done.size > 0 || s.reading.size > 0 || s.favs.length > 0 || s.notes.length > 0 || s.reviews.length > 0 || s.chats.length > 0);

// 分页拉全：PostgREST 默认单次最多 1000 行且**静默截断**，正确性数据必须循环 range 取完。
// make 必须自带稳定排序（order），否则分页窗口会重叠/漏行。
async function fetchAll<T = any>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const SIZE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await make(from, from + SIZE - 1);
    if (error) throw new Error(error.message ?? String(error));
    out.push(...(data ?? []));
    if (!data || data.length < SIZE) break;
  }
  return out;
}

// 简单并发池：同时最多 n 个任务
async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

/* ---------------- 一批用户的信号采集（in() 限定本批，每用户配额在 JS 端截断） ---------------- */
async function collectSignals(uids: string[]): Promise<Map<string, UserSignal>> {
  const [favR, tpR, mpR, revR, noteR, chatR] = await Promise.all([
    // 正确性数据（决定 排除已读/在读置顶）分页拉全
    fetchAll((f, t) => admin.from("favorites").select("user_id,book_id").in("user_id", uids).order("user_id").order("book_id").range(f, t)),
    fetchAll((f, t) => admin.from("text_progress").select("user_id,book_id,pct,last_chapter_no").in("user_id", uids).order("user_id").order("book_id").range(f, t)),
    fetchAll((f, t) => admin.from("media_progress").select("user_id,book_id,position,played").in("user_id", uids).order("user_id").order("book_id").range(f, t)),
    fetchAll((f, t) => admin.from("reviews").select("user_id,rating,title,content").in("user_id", uids).order("id").range(f, t)),
    // 画像数据（只影响排序质量）取最近 N 条即可，每用户上限在下面 JS 里卡
    admin.from("notes").select("user_id,excerpt,note").in("user_id", uids).order("created_at", { ascending: false }).limit(uids.length * 16).then((r) => r.data ?? []),
    admin.from("chat_sessions").select("user_id,messages,compressed_history").in("user_id", uids).order("updated_at", { ascending: false }).limit(uids.length * 3).then((r) => r.data ?? []),
  ]);
  const map = new Map<string, UserSignal>();
  const of = (uid: string): UserSignal => {
    let s = map.get(uid);
    if (!s) { s = { done: new Set(), reading: new Set(), favs: [], notes: [], reviews: [], chats: [] }; map.set(uid, s); }
    return s;
  };
  // 读完/在读判定与智学口径一致：文字 pct≥100 或 音视频真实覆盖≥0.9 → 已读完；有任何进度 → 在读
  for (const r of tpR as any[]) {
    const s = of(r.user_id);
    if (r.pct >= 100) s.done.add(r.book_id);
    else if (r.pct > 0 || r.last_chapter_no) s.reading.add(r.book_id);
  }
  for (const r of mpR as any[]) {
    const s = of(r.user_id);
    if (Number(r.played) >= 0.9) s.done.add(r.book_id);
    else if (Number(r.played) > 0 || Number(r.position) > 0) s.reading.add(r.book_id);
  }
  map.forEach((s) => s.done.forEach((id) => s.reading.delete(id)));
  for (const r of favR as any[]) of(r.user_id).favs.push(r.book_id);
  for (const r of noteR as any[]) {
    const s = of(r.user_id);
    if (s.notes.length < 8) s.notes.push(`「${String(r.excerpt ?? "").slice(0, 40)}」${r.note ? `→ ${String(r.note).slice(0, 50)}` : ""}`);
  }
  for (const r of revR as any[]) {
    const s = of(r.user_id);
    if (s.reviews.length < 5) s.reviews.push(`${r.rating}星${r.title ? `·${r.title}` : ""}：${String(r.content ?? "").slice(0, 80)}`);
  }
  for (const r of chatR as any[]) {
    const s = of(r.user_id);
    if (s.chats.length >= 8) continue;
    if (r.compressed_history) s.chats.push(`（历史对话摘要）${String(r.compressed_history).slice(0, 200)}`);
    const userMsgs = (Array.isArray(r.messages) ? r.messages : []).filter((m: any) => m?.role === "user").slice(-4);
    for (const m of userMsgs) if (s.chats.length < 8) s.chats.push(String(m.content ?? "").slice(0, 60));
  }
  return map;
}

/* ---------------- LLM 排序：候选书按读者画像兴趣降序；返回 [排序结果, 是否真用上了 LLM] ---------------- */
async function rankByLLM(candidates: Candidate[], s: UserSignal, bookTitle: (id: string) => string): Promise<[string[], boolean]> {
  const fallback = candidates.map((c) => c.id); // 默认序 = 最新入库在前
  if (candidates.length <= 1) return [fallback, true];
  const profile = [
    s.favs.length ? `收藏的书：${s.favs.map(bookTitle).join("、")}` : "",
    s.done.size ? `已读完：${Array.from(s.done).map(bookTitle).join("、")}` : "",
    s.reading.size ? `正在读：${Array.from(s.reading).map(bookTitle).join("、")}` : "",
    s.notes.length ? `最近笔记：${s.notes.join("；")}` : "",
    s.reviews.length ? `书评：${s.reviews.join("；")}` : "",
    s.chats.length ? `与 AI 读书伙伴的对话（反映兴趣）：${s.chats.join("；")}` : "",
  ].filter(Boolean).join("\n");
  const list = candidates.map((c) => `- id: ${c.id} |《${c.title}》| 标签: ${c.tags.join("/")} | 概要: ${c.digest.slice(0, 100)}`).join("\n");
  try {
    const out = await chatOnce(
      [
        { role: "system", content: "你是图书推荐排序引擎。把候选书按「这位读者会感兴趣的程度」从高到低排序。只输出 JSON 字符串数组（候选书的 id），不要输出任何其他文字。只能使用候选列表中出现的 id，不要遗漏、不要编造。" },
        { role: "user", content: `[读者画像]\n${profile}\n\n[候选书列表]\n${list}\n\n输出排序后的 id 数组：` },
      ],
      { model: FEED_MODEL, temperature: 0.3, maxTokens: 4096 }
    );
    // 两步解析：先取首 [ 到末 ] 的最大跨度；失败再试第一段不含嵌套的 [...]（防 LLM 夹带解释文字打穿）
    let parsed: unknown = null;
    const a = out.indexOf("["), b = out.lastIndexOf("]");
    if (a >= 0 && b > a) { try { parsed = JSON.parse(out.slice(a, b + 1)); } catch {} }
    if (!Array.isArray(parsed)) { const m = out.match(/\[[^\[\]]*\]/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
    if (!Array.isArray(parsed)) return [fallback, false];
    const valid = new Set(fallback);
    const ranked: string[] = [];
    for (const id of parsed) if (typeof id === "string" && valid.has(id) && !ranked.includes(id)) ranked.push(id);
    if (!ranked.length) return [fallback, false];
    for (const id of fallback) if (!ranked.includes(id)) ranked.push(id); // LLM 漏掉的补在尾部，保证全覆盖
    return [ranked, true];
  } catch {
    return [fallback, false]; // LLM 挂了不影响日更：退默认序
  }
}

/* ---------------- 主流程：按批生成、按批落库、带时间预算 ---------------- */
export interface FlipFeedStats {
  date: string; users: number; generated: number;
  skippedNoSignal: number; skippedExisting: number; failed: number;
  llmFallback: number;  // 有多少用户的排序退化为默认序（LLM 失败/解析失败）
  partial: boolean;     // 时间预算耗尽提前收尾（下次调用从断点续做）
}

export async function generateFlipFeeds(opts?: { force?: boolean; budgetMs?: number }): Promise<FlipFeedStats> {
  const startAt = Date.now();
  const budget = opts?.budgetMs ?? TIME_BUDGET_MS;
  const date = bjToday();
  const [profiles, videoBooks, allBooks, existingRows] = await Promise.all([
    fetchAll<any>((f, t) => admin.from("profiles").select("id").order("id").range(f, t)),
    fetchAll<any>((f, t) => admin.from("books").select("id,title,tags,ai_digest,video_url").eq("has_video", true).order("shelved_at", { ascending: false }).order("id").range(f, t)),
    fetchAll<any>((f, t) => admin.from("books").select("id,title").order("id").range(f, t)), // 全量书名（画像里已读的书可能没视频）
    opts?.force ? Promise.resolve([] as any[]) : fetchAll<any>((f, t) => admin.from("flip_feed").select("user_id").eq("gen_date", date).order("user_id").range(f, t)),
  ]);
  const candidates: Candidate[] = videoBooks
    .filter((b) => b.video_url) // has_video 但没传视频文件的剔除（坏数据护栏）
    .map((b) => ({ id: b.id, title: b.title, tags: (b.tags ?? []) as string[], digest: String(b.ai_digest ?? "") }));
  const titleMap = new Map(allBooks.map((b) => [b.id, b.title]));
  const bookTitle = (id: string) => `《${titleMap.get(id) ?? id}》`;
  const existing = new Set(existingRows.map((r) => r.user_id));

  const stats: FlipFeedStats = { date, users: profiles.length, generated: 0, skippedNoSignal: 0, skippedExisting: 0, failed: 0, llmFallback: 0, partial: false };
  if (!candidates.length) return stats; // 馆里还没有带视频的书

  const todo = profiles.map((r) => r.id as string).filter((uid) => {
    if (existing.has(uid)) { stats.skippedExisting++; return false; }
    return true;
  });

  for (let off = 0; off < todo.length; off += USER_BATCH) {
    if (Date.now() - startAt > budget) { stats.partial = true; break; } // 预算耗尽：已落库的批次都算数，下次续做
    const batch = todo.slice(off, off + USER_BATCH);
    const signals = await collectSignals(batch);
    const withSignal = batch.filter((uid) => {
      if (hasSignal(signals.get(uid))) return true;
      stats.skippedNoSignal++; // 新用户不写行 → 前端回退最新入库 50 本
      return false;
    });
    const rows = await mapLimit(withSignal, CONCURRENCY, async (uid) => {
      const s = signals.get(uid)!;
      try {
        const pool = candidates.filter((c) => !s.done.has(c.id)); // 排除已读完
        if (!pool.length) return null;
        const readingFirst = pool.filter((c) => s.reading.has(c.id)).map((c) => c.id); // 在读优先
        const rest = pool.filter((c) => !s.reading.has(c.id));
        // 候选截断后再送 LLM：feed 上限 50，送 120 个最新候选足够；超长列表会把输出 token 打爆 → 解析必败
        const [ranked, usedLLM] = await rankByLLM(rest.slice(0, CANDIDATE_CAP), s, bookTitle);
        if (!usedLLM) stats.llmFallback++;
        const tail = rest.slice(CANDIDATE_CAP).map((c) => c.id); // 截断余量按默认序接尾（凑不满 50 时仍有完整池）
        const ids = [...readingFirst, ...ranked, ...tail].slice(0, FEED_SIZE);
        return { user_id: uid, gen_date: date, book_ids: ids };
      } catch {
        stats.failed++;
        return null;
      }
    });
    const upserts = rows.filter((r): r is NonNullable<typeof r> => !!r);
    if (upserts.length) {
      // 本批立即落库：超时被掐时已写入的不会丢（注释承诺的"断点续做"由此成立）
      const { error } = await admin.from("flip_feed").upsert(upserts, { onConflict: "user_id,gen_date" });
      if (error) throw new Error(`写入 flip_feed 失败：${error.message}`);
      stats.generated += upserts.length;
    }
  }
  return stats;
}
