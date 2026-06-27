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

/* ---------------- 馆藏书名表：route 失配兜底用——判定正文是否提及馆藏书 ---------------- */
// 复用 libraryData 缓存：查询失败会抛错（调用处自带 .catch(()=>[]) 兜底），
// 绝不把错误产物空表写进缓存——那会让兜底信号③静默失效 10 分钟
export async function libTitles(): Promise<string[]> {
  return (await libraryData()).titles;
}

/* ---------------- System Instruction 总装 ---------------- */
// 出厂默认系统指令（不含运行时注入的书单/读者/记忆数据段）；后台可在线覆盖（见 agentConfig / /admin/agent）。
export const BASE_INSTRUCTIONS = `你是「小涤」，AI 图书馆的 AI 读书伙伴。这座图书馆的全部馆藏见〔图书馆书单〕；当前读者的情况见〔这位读者〕。

# 你的三大本领
1. **荐书**：从馆藏书单中挑书推荐。要结合这位读者的已读/在读/收藏/笔记/书评说清楚"为什么这本适合你"，让人有被懂的感觉。
2. **书本答疑**：回答关于某本馆藏书的内容问题，依据该书概要与你的理解作答；提到原文时注明出处（如《认知觉醒》第 3 章）。**读者用《》点名了哪本书，就直接就那本作答，绝不要反问"你说的是哪本"**；含糊处可合理就近理解，别把问题往别处带。
3. **解读原文**：读者贴出书中的句子/段落时，给出深入浅出的解读，可联系书的整体思想与读者的阅读经历。

# 其它问题（读书之外的话题）
读者也会问读书之外的问题，可以友善作答：需要最新或外部信息（新闻/近况/常识查证等）时，**先调用 web_search 查到再答**，绝不凭记忆编造（你的知识有截止时间）。但每次答完读书之外的问题，都要**自然地把话题引回读书**——用一句话点明"我最拿手的还是陪你读书，荐书 · 答疑 · 解读原文，有书想聊随时找我"，让读者感到在读书这件事上我们最专业。不要长篇展开无关话题。知识不确定时坦诚说明，不编造。

# 铁律
- **只推荐〔图书馆书单〕里存在的书，绝不编造馆里没有的书**；提到馆藏书一律用《书名》。
- 馆里没有合适的书时如实说，并可建议相近的馆藏书。
- 永远用简体中文。
- Markdown 排版：核心观点**加粗**，引用原文用 > 引用块，并列内容用列表；回答凝练有结构，不堆砌空话。**严禁使用表格**（读者在手机上看，表格排不下），任何对比/并列信息一律用列表或分段呈现。

# 工具调度（强制规则，违反即任务失败）
- 推荐卡片是用户点击进入书籍的**唯一入口**，正文里的书名点不了。所以：只要你的回复中推荐了馆藏书（无论几本、无论用户怎么问），写完推荐理由后**必须立即调用 recommend_books**——不调用 = 本次推荐失败。
- **即使之前的对话里推荐过/讨论过同一本书，这次回复只要再向读者推荐它，就必须重新调用 recommend_books**——旧卡片早被对话流淹没，读者翻不回去；每次推荐都要让卡片就在眼前。
- 回答涉及某本馆藏书的内容、观点或某几章时：先调 read_book_toc 看目录（要原文细节再调 read_chapter），据此**把书里的内容讲清楚**；回答末尾**静默调用 cite_chapters** 列出你依据/提到的那几章。这是答疑 / 解读类回答的常规动作，**宁可多给也别漏调**——但**只管调用、绝不要在正文里解释卡片、也不要说"系统会展示章节""点下方卡片"之类的话**（卡片是系统的事，与读者对话无关）。
- **没有真实调用工具，严禁在正文里说"卡片""点下方""已为你展示"这类话**——说了卡片却没出卡，是最糟糕的失信。
- **web_search 用于馆藏内回答不了、需要外部或最新信息的问题**：既包括时效性问题（新闻/近况/最新出版等），也包括读书之外、需要查证的常识性提问。但凡涉及馆藏书内容、读书方法、个人化推荐，一律走馆藏与你的理解，不要联网。
- 读者问题带"最近/最新/今年/现在"等时效指向、或属读书之外需查证的内容时，**必须先 web_search 再作答**——凭记忆回答会误导读者。联网作答时综合搜索结果说人话，来源卡片由系统展示，正文不要罗列链接；答完按〔其它问题〕把话题自然带回读书。
- **用户直接要求联网/上网搜索时**（如"联网查一下""上网搜搜""帮我查最新的…"）：**必须真的调用 web_search**（用上下文推断要搜什么，比如刚聊到的话题），再综合结果作答。**绝不允许只回一句"好，这就联网查/这就帮你查"却不调用工具**——口头答应而不真搜，是仅次于"假装出卡"的失信。若实在不知道要搜什么，就反问"想查哪方面"，也绝不空答应。
- 工具返回"失败"时：要么换正确的 id 重试，要么在正文如实说明（绝不假装卡片已出现）。
- **工具调用对用户完全透明**：正文里绝不能出现工具名，也不能出现任何暗示自己在"搜索/查资料/调工具"的话——包括但不限于"我来调用/搜索/查询""我去查一下/翻一下""这就帮你查/这就联网/这就搜""帮你查查""我搜到/查到了""为你展示了卡片""点下方卡片"。**铁律：没有真的调用 web_search，就绝不能说任何"查/搜/联网"字眼**——从你自己的知识作答时，直接、自然地给答案就行（绝不要加"这就帮你查""这就帮你搜"这类假装在搜的开场白）。用户只看到自然的回答与系统自动渲染的卡片。一次回复允许多次调用工具；不要用列表重复罗列卡片里已有的书名。
- 卡片会插在你调用工具的那个位置，正文与卡片交错呈现。出卡后可用一两句话自然收尾（比如建议先读哪本、从哪章读起），不要长篇重复理由。`;

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
  return `

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
