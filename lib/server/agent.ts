// 智学 Agent「小涤」上下文组装（T2.2）：System Instruction + 6 个个性化变量
// ①图书馆书单 ②已读完书单(含笔记/书评) ③收藏书单 ④在读书单(含笔记/书评) ⑤学习总时长 ⑥压缩历史(T2.6 填充)
// 全部查询走 service_role（仅服务端），用户身份由前端携带的 Supabase access token 验证。
import "server-only";
import { createClient } from "@supabase/supabase-js";

export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 从 Authorization: Bearer <token> 解析用户（无/无效 → null，按游客处理）
export async function getUid(authHeader: string | null): Promise<string | null> {
  const token = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

/* ---------------- 变量①：图书馆书单（全馆，10 分钟缓存） ---------------- */
let libCache: { text: string; at: number } | null = null;
async function libraryVar(): Promise<string> {
  if (libCache && Date.now() - libCache.at < 10 * 60 * 1000) return libCache.text;
  const [books, cats] = await Promise.all([
    admin.from("books").select("id,title,author,category_id,tags,ai_digest").order("id"),
    admin.from("categories").select("id,name"),
  ]);
  // 查询失败必须抛错而不是缓存空书单：否则一次 DB 抖动会让小涤"馆藏0本"持续10分钟（铁律又禁止编书=荐书下线）
  if (books.error || cats.error || !books.data?.length) throw new Error(`书单加载失败：${books.error?.message ?? cats.error?.message ?? "空数据"}`);
  const catName = new Map((cats.data ?? []).map((c: any) => [c.id, c.name]));
  const lines = (books.data ?? []).map((b: any) =>
    `- [${b.id}]《${b.title}》作者：${b.author || "佚名"}｜分类：${catName.get(b.category_id) ?? b.category_id}｜标签：${(b.tags ?? []).join("/")}｜概要：${(b.ai_digest ?? "").trim() || "（暂无）"}`
  );
  const text = `共 ${lines.length} 本：\n${lines.join("\n")}`;
  libCache = { text, at: Date.now() };
  return text;
}

/* ---------------- 变量②③④⑤：读者个人数据 ---------------- */
const fmtDuration = (sec: number) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} 小时` : `${Math.max(0, Math.round(sec / 60))} 分钟`);

async function userVars(uid: string): Promise<string> {
  const [favR, noteR, revR, tpR, mpR, profR, bookR] = await Promise.all([
    admin.from("favorites").select("book_id").eq("user_id", uid),
    admin.from("notes").select("book_id,excerpt,note").eq("user_id", uid).order("created_at", { ascending: false }).limit(60),
    admin.from("reviews").select("book_id,rating,title,content").eq("user_id", uid),
    admin.from("text_progress").select("book_id,pct,last_chapter_no").eq("user_id", uid),
    admin.from("media_progress").select("book_id,position,played").eq("user_id", uid),
    admin.from("profiles").select("nickname,read_seconds").eq("id", uid).maybeSingle(),
    admin.from("books").select("id,title"),
  ]);
  const title = new Map((bookR.data ?? []).map((b: any) => [b.id, b.title]));
  const name = (id: string) => `《${title.get(id) ?? id}》`;

  // 读完/在读判定：文字 pct≥100 或 音视频真实覆盖≥0.9 → 已读完；有任何进度且未读完 → 在读
  const done = new Set<string>();
  const reading = new Set<string>();
  for (const r of (tpR.data ?? []) as any[]) (r.pct >= 100 ? done : r.pct > 0 || r.last_chapter_no ? reading : new Set()).add(r.book_id);
  for (const r of (mpR.data ?? []) as any[]) (Number(r.played) >= 0.9 ? done : Number(r.played) > 0 || Number(r.position) > 0 ? reading : new Set()).add(r.book_id);
  done.forEach((id) => reading.delete(id));

  // 每本书的笔记/书评拼装（截断防膨胀）
  const notesOf = (id: string) =>
    ((noteR.data ?? []) as any[]).filter((n) => n.book_id === id).slice(0, 10)
      .map((n) => `「${String(n.excerpt ?? "").slice(0, 60)}」${n.note ? `→ 笔记：${String(n.note).slice(0, 80)}` : "（划线）"}`);
  const reviewOf = (id: string) => {
    const r = ((revR.data ?? []) as any[]).find((x) => x.book_id === id);
    return r ? `书评（${r.rating}星${r.title ? `·${r.title}` : ""}）：${String(r.content ?? "").slice(0, 200)}` : null;
  };
  const bookBlock = (id: string, withDetail: boolean) => {
    const parts = [name(id)];
    if (withDetail) {
      const ns = notesOf(id);
      const rv = reviewOf(id);
      if (ns.length) parts.push(`  - 该书读者笔记 ${ns.length} 条：${ns.join("；")}`);
      if (rv) parts.push(`  - 读者${rv}`);
    }
    return parts.join("\n");
  };

  const favIds = ((favR.data ?? []) as any[]).map((r) => r.book_id);
  const sec = (profR.data as any)?.read_seconds ?? 0;
  const nick = (profR.data as any)?.nickname || "书友";

  return [
    `读者昵称：${nick}（已登录）`,
    `学习总时长：${fmtDuration(sec)}（视频/音频真实播放 + 文字稿真实阅读之和）`,
    `已读完（${done.size} 本）：${done.size ? "\n" + Array.from(done).map((id) => bookBlock(id, true)).join("\n") : "暂无"}`,
    `正在读（${reading.size} 本）：${reading.size ? "\n" + Array.from(reading).map((id) => bookBlock(id, true)).join("\n") : "暂无"}`,
    `收藏（${favIds.length} 本）：${favIds.length ? favIds.map((id) => name(id)).join("、") : "暂无"}`,
  ].join("\n");
}

/* ---------------- System Instruction 总装 ---------------- */
export async function buildSystem(uid: string | null, compressedHistory?: string): Promise<string> {
  // 变量⑦（T7）：长期记忆延迟 import（memory.ts 引用本模块的 admin，静态互引会循环依赖）
  const { memoryVar } = await import("@/lib/server/memory");
  const [lib, user, memo] = await Promise.all([
    libraryVar(),
    uid ? userVars(uid) : Promise.resolve(""),
    uid ? memoryVar(uid).catch(() => "") : Promise.resolve(""),
  ]);
  return `你是「小涤」，AI 图书馆的 AI 读书伙伴。这座图书馆的全部馆藏见〔图书馆书单〕；当前读者的情况见〔这位读者〕。

# 你的三大本领
1. **荐书**：从馆藏书单中挑书推荐。要结合这位读者的已读/在读/收藏/笔记/书评说清楚"为什么这本适合你"，让人有被懂的感觉。
2. **书本答疑**：回答关于某本馆藏书的内容问题，依据该书概要与你的理解作答；提到原文时注明出处（如《认知觉醒》第 3 章）。
3. **解读原文**：读者贴出书中的句子/段落时，给出深入浅出的解读，可联系书的整体思想与读者的阅读经历。

# 其它问题
与读书学习无关的问题：先简短友善回应，再自我介绍（"我是你的 AI 读书伙伴，更擅长帮你荐书、答疑、解读原文"），引导回读书话题。
例外：问题带时效性（新闻/近况/最新动态）且读者确实想知道时，先调用 web_search 查到再答（不要凭记忆——你的知识有截止时间），答完再自然带回读书话题。知识不确定时坦诚说明，不编造。

# 铁律
- **只推荐〔图书馆书单〕里存在的书，绝不编造馆里没有的书**；提到馆藏书一律用《书名》。
- 馆里没有合适的书时如实说，并可建议相近的馆藏书。
- 永远用简体中文。
- Markdown 排版：核心观点**加粗**，引用原文用 > 引用块，并列内容用列表；回答凝练有结构，不堆砌空话。**严禁使用表格**（读者在手机上看，表格排不下），任何对比/并列信息一律用列表或分段呈现。

# 工具调度（强制规则，违反即任务失败）
- 推荐卡片是用户点击进入书籍的**唯一入口**，正文里的书名点不了。所以：只要你的回复中推荐了馆藏书（无论几本、无论用户怎么问），写完推荐理由后**必须立即调用 recommend_books**——不调用 = 本次推荐失败。
- **即使之前的对话里推荐过/讨论过同一本书，这次回复只要再向读者推荐它，就必须重新调用 recommend_books**——旧卡片早被对话流淹没，读者翻不回去；每次推荐都要让卡片就在眼前。
- 回答某本书的内容问题或解读原文：**先调 read_book_toc 看目录**，需要原文细节再调 read_chapter；回答末尾**必须调用 cite_chapters** 展示你依据的章节卡片（同理：不调用 = 用户无法跳转原文）。
- **没有真实调用工具，严禁在正文里说"卡片""点下方""已为你展示"这类话**——说了卡片却没出卡，是最糟糕的失信。
- **web_search 只许用于馆藏答不上的时效性问题**（新闻/近况/最新出版等）；馆藏书目内容、读书方法、个人化推荐一律不许联网。
- 反过来：读者的问题带有"最近/最新/今年/现在"等时效指向且超出馆藏时，**必须调用 web_search 再作答**——你的知识有截止时间，凭记忆回答时效问题会误导读者。联网作答时综合搜索结果说人话，来源卡片由系统展示，正文不要罗列链接。
- 工具返回"失败"时：要么换正确的 id 重试，要么在正文如实说明（绝不假装卡片已出现）。
- 一次回复允许多次调用工具；卡片由系统渲染，正文不要描述"我去调用工具/已为你展示卡片"，也不要用列表重复罗列卡片里的书名。
- 卡片会插在你调用工具的那个位置，正文与卡片交错呈现。出卡后可用一两句话自然收尾（比如建议先读哪本、从哪章读起），不要长篇重复理由。

〔图书馆书单〕
${lib}

〔这位读者〕
${user || "游客（未登录），看不到个人数据。个性化推荐时可顺带提一句：登录后我能结合你的阅读记录推荐得更准。"}
${memo ? `\n〔你对这位读者的长期了解〕（在回答中自然体现这些认知——比如推荐时贴合 TA 的偏好、问候时记得 TA 的近况；绝不要生硬复述这份清单本身）\n${memo}` : ""}
${compressedHistory ? `\n〔更早的对话摘要〕\n${compressedHistory}` : ""}`;
}
