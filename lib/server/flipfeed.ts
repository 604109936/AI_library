// T3.1 乱翻日更生成器：每天为每位读者生成 ≤50 本「猜你想读」写入 flip_feed。
// 规则：排除已读完 → 在读优先置顶 → 其余候选交给 minimax 按读者画像（收藏/已读/笔记/书评/对话偏好）排序。
// 兜底链：LLM 失败 → 候选按最新入库序；无任何个人数据的新用户 → 不写行（getFlip 读不到时回退最新入库 50 本）。
// 幂等：跳过当天已生成的用户（serverless 超时被掐后，下次调用从断点续做）；force 可强制重生成。
import "server-only";
import { admin } from "@/lib/server/agent";
import { chatOnce } from "@/lib/server/minimax";

// 排序走便宜快的模型（与压缩同款思路）；要换模型只需在 .env.local 设 MINIMAX_FEED_MODEL
const FEED_MODEL = process.env.MINIMAX_FEED_MODEL || "MiniMax-Text-01";
const FEED_SIZE = 50;
const CONCURRENCY = 4; // 同时给几位用户跑 LLM 排序（防 MiniMax 限流）

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
const hasSignal = (s: UserSignal) =>
  s.done.size > 0 || s.reading.size > 0 || s.favs.length > 0 || s.notes.length > 0 || s.reviews.length > 0 || s.chats.length > 0;

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

/* ---------------- 全量信号采集（批量查询一次，JS 内按用户分组——避免每用户 6 连查打爆 DB） ---------------- */
async function collectSignals(): Promise<Map<string, UserSignal>> {
  const [favR, tpR, mpR, noteR, revR, chatR] = await Promise.all([
    admin.from("favorites").select("user_id,book_id"),
    admin.from("text_progress").select("user_id,book_id,pct,last_chapter_no"),
    admin.from("media_progress").select("user_id,book_id,position,played"),
    admin.from("notes").select("user_id,excerpt,note,created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("reviews").select("user_id,rating,title,content"),
    // 对话偏好：取最近更新的会话（含压缩摘要）；规模大了之后改按用户各取最近 1 条
    admin.from("chat_sessions").select("user_id,messages,compressed_history,updated_at").order("updated_at", { ascending: false }).limit(300),
  ]);
  const map = new Map<string, UserSignal>();
  const of = (uid: string): UserSignal => {
    let s = map.get(uid);
    if (!s) { s = { done: new Set(), reading: new Set(), favs: [], notes: [], reviews: [], chats: [] }; map.set(uid, s); }
    return s;
  };
  // 读完/在读判定与智学口径一致：文字 pct≥100 或 音视频真实覆盖≥0.9 → 已读完；有任何进度 → 在读
  for (const r of (tpR.data ?? []) as any[]) {
    const s = of(r.user_id);
    if (r.pct >= 100) s.done.add(r.book_id);
    else if (r.pct > 0 || r.last_chapter_no) s.reading.add(r.book_id);
  }
  for (const r of (mpR.data ?? []) as any[]) {
    const s = of(r.user_id);
    if (Number(r.played) >= 0.9) s.done.add(r.book_id);
    else if (Number(r.played) > 0 || Number(r.position) > 0) s.reading.add(r.book_id);
  }
  map.forEach((s) => s.done.forEach((id) => s.reading.delete(id)));
  for (const r of (favR.data ?? []) as any[]) of(r.user_id).favs.push(r.book_id);
  for (const r of (noteR.data ?? []) as any[]) {
    const s = of(r.user_id);
    if (s.notes.length < 8) s.notes.push(`「${String(r.excerpt ?? "").slice(0, 40)}」${r.note ? `→ ${String(r.note).slice(0, 50)}` : ""}`);
  }
  for (const r of (revR.data ?? []) as any[]) {
    const s = of(r.user_id);
    if (s.reviews.length < 5) s.reviews.push(`${r.rating}星${r.title ? `·${r.title}` : ""}：${String(r.content ?? "").slice(0, 80)}`);
  }
  for (const r of (chatR.data ?? []) as any[]) {
    const s = of(r.user_id);
    if (s.chats.length >= 8) continue;
    if (r.compressed_history) s.chats.push(`（历史对话摘要）${String(r.compressed_history).slice(0, 200)}`);
    const userMsgs = (Array.isArray(r.messages) ? r.messages : []).filter((m: any) => m?.role === "user").slice(-4);
    for (const m of userMsgs) if (s.chats.length < 8) s.chats.push(String(m.content ?? "").slice(0, 60));
  }
  return map;
}

/* ---------------- LLM 排序：候选书按读者画像兴趣降序 ---------------- */
async function rankByLLM(candidates: Candidate[], s: UserSignal, bookTitle: (id: string) => string): Promise<string[]> {
  const fallback = candidates.map((c) => c.id); // 默认序 = 最新入库在前
  if (candidates.length <= 1) return fallback;
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
      { model: FEED_MODEL, temperature: 0.3, maxTokens: 3000 }
    );
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) return fallback;
    const valid = new Set(fallback);
    const ranked: string[] = [];
    for (const id of parsed) if (typeof id === "string" && valid.has(id) && !ranked.includes(id)) ranked.push(id);
    for (const id of fallback) if (!ranked.includes(id)) ranked.push(id); // LLM 漏掉的补在尾部，保证全覆盖
    return ranked;
  } catch {
    return fallback; // LLM 挂了不影响日更：退默认序
  }
}

/* ---------------- 主流程 ---------------- */
export async function generateFlipFeeds(opts?: { force?: boolean }): Promise<{
  date: string; users: number; generated: number; skippedNoSignal: number; skippedExisting: number; failed: number;
}> {
  const date = bjToday();
  const [profR, bookR, allBookR, doneR] = await Promise.all([
    admin.from("profiles").select("id"),
    admin.from("books").select("id,title,tags,ai_digest,video_url").eq("has_video", true).order("shelved_at", { ascending: false }),
    admin.from("books").select("id,title"), // 全量书名（画像里已读的书可能没视频）
    opts?.force ? Promise.resolve({ data: [] as any[] }) : admin.from("flip_feed").select("user_id").eq("gen_date", date),
  ]);
  if (profR.error) throw new Error(`读取用户失败：${profR.error.message}`);
  if (bookR.error) throw new Error(`读取书目失败：${bookR.error.message}`);
  const candidates: Candidate[] = ((bookR.data ?? []) as any[])
    .filter((b) => b.video_url) // has_video 但没传视频文件的剔除（坏数据护栏）
    .map((b) => ({ id: b.id, title: b.title, tags: (b.tags ?? []) as string[], digest: String(b.ai_digest ?? "") }));
  const titleMap = new Map(((allBookR.data ?? []) as any[]).map((b) => [b.id, b.title]));
  const bookTitle = (id: string) => `《${titleMap.get(id) ?? id}》`;
  const existing = new Set(((doneR.data ?? []) as any[]).map((r) => r.user_id));

  const stats = { date, users: (profR.data ?? []).length, generated: 0, skippedNoSignal: 0, skippedExisting: 0, failed: 0 };
  if (!candidates.length) return stats; // 馆里还没有带视频的书

  const signals = await collectSignals();
  const todo = ((profR.data ?? []) as any[]).map((r) => r.id as string).filter((uid) => {
    if (existing.has(uid)) { stats.skippedExisting++; return false; }
    const s = signals.get(uid);
    if (!s || !hasSignal(s)) { stats.skippedNoSignal++; return false; } // 新用户不写行 → 前端回退最新入库 50 本
    return true;
  });

  const rows = await mapLimit(todo, CONCURRENCY, async (uid) => {
    const s = signals.get(uid)!;
    try {
      const pool = candidates.filter((c) => !s.done.has(c.id)); // 排除已读完
      if (!pool.length) return null;
      const readingFirst = pool.filter((c) => s.reading.has(c.id)).map((c) => c.id); // 在读优先
      const rest = pool.filter((c) => !s.reading.has(c.id));
      const ranked = await rankByLLM(rest, s, bookTitle);
      const ids = [...readingFirst, ...ranked].slice(0, FEED_SIZE);
      return { user_id: uid, gen_date: date, book_ids: ids };
    } catch {
      stats.failed++;
      return null;
    }
  });

  const upserts = rows.filter((r): r is NonNullable<typeof r> => !!r);
  if (upserts.length) {
    const { error } = await admin.from("flip_feed").upsert(upserts, { onConflict: "user_id,gen_date" });
    if (error) throw new Error(`写入 flip_feed 失败：${error.message}`);
    stats.generated = upserts.length;
  }
  return stats;
}
