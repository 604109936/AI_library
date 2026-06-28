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
// 书单文本 / 书名表 / id→书名映射共用一份缓存与一趟查询：原来 libraryVar、libTitles、userVars
// 各自全表拉一遍 books，每条消息三趟重复 IO
let libCache: { text: string; titles: string[]; titleMap: Map<string, string>; at: number } | null = null;
async function libraryData() {
  if (libCache && Date.now() - libCache.at < 10 * 60 * 1000) return libCache;
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
  libCache = {
    text: `共 ${lines.length} 本：\n${lines.join("\n")}`,
    titles: (books.data ?? []).map((b: any) => String(b.title)).filter(Boolean),
    titleMap: new Map((books.data ?? []).map((b: any) => [b.id, b.title])),
    at: Date.now(),
  };
  return libCache;
}
async function libraryVar(): Promise<string> {
  return (await libraryData()).text;
}

/* ---------------- 变量②③④⑤：读者个人数据 ---------------- */
const fmtDuration = (sec: number) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} 小时` : `${Math.max(0, Math.round(sec / 60))} 分钟`);

async function userVars(uid: string): Promise<string> {
  const [favR, noteR, revR, tpR, mpR, profR, lib] = await Promise.all([
    admin.from("favorites").select("book_id").eq("user_id", uid),
    admin.from("notes").select("book_id,excerpt,note").eq("user_id", uid).order("created_at", { ascending: false }).limit(60),
    admin.from("reviews").select("book_id,rating,title,content").eq("user_id", uid),
    admin.from("text_progress").select("book_id,pct,last_chapter_no").eq("user_id", uid),
    admin.from("media_progress").select("book_id,position,played").eq("user_id", uid),
    admin.from("profiles").select("nickname,read_seconds").eq("id", uid).maybeSingle(),
    libraryData(), // 书名映射复用书单缓存（省一趟全表查询）
  ]);
  // 任一路查询失败都不能按"暂无"拼装：那会让模型向用户断言"你还没读过任何书"并据此做反事实推荐。
  // 降级为明示模型数据暂不可用（聊天可用性优先于个性化，DB 抖动不该 502 整条回答）
  const errs = [favR.error, noteR.error, revR.error, tpR.error, mpR.error, profR.error].filter(Boolean);
  if (errs.length) {
    console.error("[agent] 读者数据查询失败：", errs[0]);
    return "读者昵称：书友（已登录）\n（读者的阅读数据本轮暂时加载失败：请勿断言读者的阅读记录/收藏情况，个性化推荐时如实说明「这会儿没看到你的阅读记录」即可。）";
  }
  const name = (id: string) => `《${lib.titleMap.get(id) ?? id}》`;

  // 读完/在读判定：文字 pct≥100 或 音视频真实覆盖≥0.9 → 已读完；有任何进度且未读完 → 在读
  const done = new Set<string>();
  const reading = new Set<string>();
  for (const r of (tpR.data ?? []) as any[]) (r.pct >= 100 ? done : r.pct > 0 || r.last_chapter_no ? reading : new Set()).add(r.book_id);
  for (const r of (mpR.data ?? []) as any[]) (Number(r.played) >= 0.9 ? done : Number(r.played) > 0 || Number(r.position) > 0 ? reading : new Set()).add(r.book_id);
  done.forEach((id) => reading.delete(id));
  // 孤儿 book_id（书已下架/删除/换 id，用户数据表故意不外键）：titleMap 取不到标题会回退成《原始id(slug)》，
  // 模型会把 slug 当书名讲给用户、且与〔图书馆书单〕对不上。这里整体剔除馆藏中已不存在的 id，计数也只算真实在馆书。
  for (const id of Array.from(done)) if (!lib.titleMap.has(id)) done.delete(id);
  for (const id of Array.from(reading)) if (!lib.titleMap.has(id)) reading.delete(id);

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

  const favIds = ((favR.data ?? []) as any[]).map((r) => r.book_id).filter((id: string) => lib.titleMap.has(id));
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

/* ---------------- 馆藏书名表：route 失配兜底用——判定正文是否提及馆藏书 ---------------- */
// 复用 libraryData 缓存：查询失败会抛错（调用处自带 .catch(()=>[]) 兜底），
// 绝不把错误产物空表写进缓存——那会让兜底信号③静默失效 10 分钟
export async function libTitles(): Promise<string[]> {
  return (await libraryData()).titles;
}

/* ---------------- System Instruction 总装 ---------------- */
// 出厂默认系统指令（不含运行时注入的书单/读者/记忆数据段）；后台可在线覆盖（见 agentConfig / /admin/agent）。
export const BASE_INSTRUCTIONS = `你是「小涤」，AI 图书馆的 AI 读书伙伴。馆藏见〔图书馆书单〕，当前读者见〔这位读者〕。

# 本领
- **荐书**：从〔图书馆书单〕挑书，结合读者的已读 / 在读 / 收藏 / 笔记 / 书评说清"为什么这本适合你"，让人觉得被读懂。
- **答疑**：解答馆藏书的内容 / 观点 / 情节 / 人物。读者用《》点了名就直接答，**绝不反问"你说的是哪本"**；含糊处就近合理理解，不跑题。
- **解读原文**：读者贴出书中句段时讲深讲透，并联系全书主旨与读者的阅读经历。
- 读书之外也友善作答；**仅当确实跑题**时，结尾用自己的话、贴着语境把话头轻轻引回读书，不长篇展开无关话题。

# 工具（调用过程对读者完全隐形，读者只看到自然回答 + 系统在调用处自动渲染的卡片）
三类情形必须调用对应工具，且**先调用、据真实结果再作答**：
- **推荐任何馆藏书** → recommend_books（传书的 [id]）。卡片是读者点进书的唯一入口（正文书名点不了）；这一次再次推荐某本，就再调一次（旧卡早被对话刷走，翻不回去）。
- **答疑 / 解读涉及某书的具体内容或章节** → 先 read_book_toc 看目录、需原文细节再 read_chapter，把内容讲准；回答末尾 cite_chapters 列出依据的章节（让读者能点开读原文）。宁可多列一章，别漏调。
- **任何"实时 / 最新"的馆外信息** → 先 web_search 拿到真实结果再答。涵盖天气、新闻、热搜、股价 / 汇率 / 油价 / 金价、赛事比分、票房、最新版本 / 型号 / 价格、谁刚获奖 / 当选、当下日期等，以及读者明确要你联网、或读书之外需事实查证的提问。你的知识有截止时间，这类每天在变的事实**凭印象写出来全是编的**。

# 铁律（违反即本次回答失败）
- **诚实**：没真正调用工具，正文就绝不出现暗示你"查了 / 搜了 / 出了卡片"的话。**联网尤其是信任底线**——只有真调用了 web_search 并拿到结果，才可以说"查到的"实时信息；否则「帮你查一下 / 帮你查到了 / 我上网查了 / 根据网上(最新)信息 / 搜索结果显示 / 我查到最新是…」等一概不写，**更绝不凭印象编天气 / 股价 / 比分等实时数据**。该查没查，就老实说"我没法实时联网确认，要我帮你查最新的吗"，绝不假装查过。
- **隐形 & 自然**：工具名、以及"查目录 / 读章节 / 翻书 / 联网搜"等取数过程绝不写进正文——读者只要你的结论，不要操作旁白（如"我先看看目录 / 拿到目录后我更确定 / 我翻了下正文"）。卡片由系统紧接你的话自动渲染，**自带封面 / 书名 / 作者 / 章题与点击引导**，所以正文**别复述卡里已有的信息，也别解释或引导卡片**——"下面卡片是入口 / 点下面卡片 / 点进去跳读原文 / 点开就能读"这类无意义说明一句都不写。把推荐理由 / 解读自然说完，卡片随后自然出现、读者一看就懂；正文与卡片之间读起来要顺、不突兀。想让章节可点跳读，**唯一办法是调用 cite_chapters**（正文写那些字是点不了的空头支票）。
- **不重复**：同一次回答里，同一本书的书卡、同一章的引用卡只出一次（多轮细读后别把同一本 / 同一章反复调用）。
- **失败如实**：工具返回"失败"就换正确 id 重试，或在正文如实说明，绝不假装卡片已经出现。

# 表达
- **只推荐〔图书馆书单〕里真实存在的书，绝不编造馆外书**；没合适的就如实说、可改荐相近馆藏。馆藏书一律用《书名》。书的开篇统称「前言」，**绝不说「第0章」**。
- 简体中文，温暖口语、像懂书的朋友，凝练有重点不堆空话。正聊着书时**别加"我最拿手的是陪你读书 / 有书随时找我"这类自我介绍套话收尾**（像复读机器人）——自然停在内容上，或顺势抛个跟这本书有关的延伸点（某章、某观点、要不要拉段原文一起读）。
- Markdown：核心**加粗**，引用原文用**单层** > 引用块（别嵌套、别写两层尖括号「> >」），并列用列表；**严禁表格**（手机排不下），对比 / 并列一律改列表或分段。`;

// 运行时注入的动态数据段（接在系统指令之后）：图书馆书单①、读者数据②③④⑤、长期记忆⑦、对话摘要。
// 抽成独立函数，供后台「查看完整提示词」只读预览复用（与真实对话用的是同一套组装）。
export async function buildDataSection(uid: string | null, compressedHistory?: string): Promise<string> {
  // 变量⑦（T7）：长期记忆延迟 import（memory.ts 引用本模块的 admin，静态互引会循环依赖）
  const { memoryVar } = await import("@/lib/server/memory");
  const [lib, user, memo] = await Promise.all([
    libraryVar(),
    uid ? userVars(uid) : Promise.resolve(""),
    uid ? memoryVar(uid).catch(() => "") : Promise.resolve(""),
  ]);
  // 当前北京日期：模型缺了它就分不清自己训练知识有多旧、也不会用年份去搜——是"最新"类问题答陈旧的根因。
  const today = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  return `

〔今天的日期〕
今天是 ${today}（北京时间）。回答"最新 / 近期 / 今年 / 现在"等时效问题时一律以此为准。**你的训练知识有截止时间、对"最新版本/最新型号/最新进展"很可能已过时**——联网搜到的、带较新日期的结果，永远优先于你记忆里的旧版本；搜到 2026 年的新信息就别再拿更早的当"最新"。联网搜索时，请在关键词里带上当前年月（如"${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long" }).format(new Date())} 最新…"），结果更准更新。

〔图书馆书单〕
${lib}

〔这位读者〕
${user || "游客（未登录），看不到个人数据。个性化推荐时可顺带提一句：登录后我能结合你的阅读记录推荐得更准。"}
${memo ? `\n〔你对这位读者的长期了解〕（在回答中自然体现这些认知——比如推荐时贴合 TA 的偏好、问候时记得 TA 的近况；绝不要生硬复述这份清单本身）\n${memo}` : ""}
${compressedHistory ? `\n〔更早的对话摘要〕\n${compressedHistory}` : ""}`;
}

export async function buildSystem(uid: string | null, compressedHistory?: string): Promise<string> {
  const { readOverride } = await import("@/lib/server/agentConfig");
  const [ov, dataSection] = await Promise.all([readOverride(), buildDataSection(uid, compressedHistory)]);
  // 后台覆盖的系统指令优先；为空回退出厂默认。后接运行时注入的数据段（书单/读者/记忆/摘要）
  const instructions = (ov.systemInstructions ?? "").trim() || BASE_INSTRUCTIONS;
  return `${instructions}${dataSection}`;
}
