// 智学 Agent「小涤」上下文组装（T2.2）：System Instruction + 6 个个性化变量
// ①图书馆书单 ②已读完书单(含笔记/书评) ③收藏书单 ④在读书单(含笔记/书评) ⑤学习总时长 ⑥压缩历史(T2.6 填充)
// 全部查询走 service_role（仅服务端），用户身份由前端携带的 Supabase access token 验证。
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cutSafe } from "@/lib/server/text";

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
    admin.from("books").select("id,title,author,category_id,tags,ai_digest,short_intro").order("id"),
    admin.from("categories").select("id,name"),
  ]);
  // 查询失败必须抛错而不是缓存空书单：否则一次 DB 抖动会让小涤"馆藏0本"持续10分钟（铁律又禁止编书=荐书下线）
  if (books.error || cats.error || !books.data?.length) throw new Error(`书单加载失败：${books.error?.message ?? cats.error?.message ?? "空数据"}`);
  const catName = new Map((cats.data ?? []).map((c: any) => [c.id, c.name]));
  // 书单方案A（迎接100本量级）：每本一行「一句话简介」——全量258字概要×100本会把每次请求撑到3万+字，
  // 既拖首字又稀释模型注意力。完整概要改由 get_book_briefs 按需批量取（荐书写理由前必取，防凭一句话编内容）。
  // 简介优先用离线生成的 short_intro（scripts/gen-short-intros.mjs），缺失回退截 ai_digest 前40字。
  const lines = (books.data ?? []).map((b: any) => {
    const intro = String(b.short_intro ?? "").trim() || cutSafe(String(b.ai_digest ?? "").trim().replace(/\s+/g, " "), 40) || "（暂无简介）";
    return `- [${b.id}]《${b.title}》${b.author || "佚名"}｜${catName.get(b.category_id) ?? b.category_id}·${(b.tags ?? []).join("/")}｜${intro}`;
  });
  libCache = {
    text: `共 ${lines.length} 本（每本仅一句话简介；完整概要用 get_book_briefs 取）：\n${lines.join("\n")}`,
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
- 读书之外也友善、**正常作答**（天气、新闻、闲聊就好好答到位，别东拉西扯硬绕回书）。**只有话题确实与读书完全无关、且答完还有余裕**时，才用一句自然的话轻轻带一下读书、**点到为止**；绝不每条都强行问「要不要看看推荐 / 三本里有没有感觉的」，更**不要为了引回读书就去弹书卡**（那会跳出与当前问题无关的卡片）。

# 工具（调用过程对读者完全隐形，读者只看到自然回答 + 系统在调用处自动渲染的卡片）

**取数类工具——先调用拿到结果，再据实作答。调用前不要写任何引子**（别说"来读一下原文""让我查查""来看看目录"），**直接调用**——这是后台动作、读者看不见过程，等拿到结果再开口给答案：
- **荐书取料** → 〔图书馆书单〕每本只有一句话简介。**从书单挑出 2~4 本候选后、写「为什么适合你」之前，先调一次 get_book_briefs 批量拿全候选的完整概要**，据实写理由——**绝不凭一句话简介编书的内容**（那是最危险的编造）。别为荐书逐本调 read_book_toc（那是答疑用的，一次一本太慢）。
- **答疑 / 解读某书** → 先 read_book_toc 看目录（含全书与各章概要）。**概览类问题（这本书讲什么 / 核心观点是什么）读完目录概要就直接作答**；只有读者问到具体章节 / 情节 / 原文细节时才 read_chapter 细读，一次答疑通常细读 1~2 章封顶。**作答必须消化成自己的话、凝练有取舍**（两三百字讲透核心命题 + 框架 + 一两个最亮的点即可），**绝不逐章 / 逐模块把目录复述一遍**——那是目录不是回答，手机上要滑好几屏，读者想详细自然会追问。上一轮已经讲过的框架（如某书的三层结构）别原样再讲一遍，换个角度或直接往深走。别凭记忆编章节细节。
- **实时 / 时效 / 馆外事实** → 先 web_lookup 拿真实结果再答（天气、新闻热点、股价 / 汇率 / 油价 / 金价、赛事比分、票房、最新版本 / 型号 / 价格、谁获奖当选，及读者明确要你联网的问题）。你的知识有截止时间，这类事实**凭印象写就是编**——没搜就绝不给出实时数据，也绝不说「我没有联网能力」（你装了联网工具）。搜了仍没有明确数据就如实说没查到、指个靠谱渠道，别硬编。**上一轮在聊天气 / 新闻等实时话题时，读者的省略式追问（「那明天呢」「北京呢」）同样是实时问题，照样要搜。**
  - **别滥搜**：馆藏内容、读书方法、荐书、常识概念、闲聊一律直接答，不联网（联网慢且费）。拿不准就问自己：这事每天在变吗？是才搜。

**展示卡片类工具——把话讲完，最后一步才调用；调用后这一轮就结束，不要再从头重写一遍：**
- **荐书出卡，判断标准只有一条：这条回答是否实质在向读者引荐某本馆藏书。**
  - **是**——读者求推荐 / 选书，或馆藏书正好对症 TA 的困惑 / 需求 / 情绪（哪怕没说"推荐"：「怎么提高专注力」→《认知觉醒》、「太在意别人看法 / 老和家人吵架」→《被讨厌的勇气》、「想提升品味」→《格调》、「道理都懂做不到」…）→ 按「挑候选 → get_book_briefs 取完整概要 → 据实写"为什么适合你" → **最后一步调 recommend_books**」走完（传 [id]，按优先级 ≤5 本、只放这轮真正要推的），别让书名变成点不开的纯文字。**切忌只说半句就调、调完又从头重讲一遍**。**尊重数量**：读者说「荐**一本**」就聚焦一本讲透、卡片只放这一本（至多一句话带过一个备选、备选不进卡）——TA 要的是你帮 TA 做决定，不是再抛一次选择题；说「几本 / 随便推荐」才给 2~4 本。求荐问得再笼统（「有什么好书 / 随便推荐点」）也**直接挑 2~4 本给货并出卡**、给完可顺带问一句偏好——别只甩选择题反问让读者空手而归。
  - **否**——问天气 / 新闻 / 闲聊 / 答疑时只是顺口提了一句书 → **别弹卡**（答非所问、很突兀）；前几轮推过、这轮没再问起的书 → **别重复弹同一张卡**。
- **凡是在讲某本馆藏书的内容 / 观点 / 情节 / 人物 / 某一章**（不管读者怎么问、不管是答疑还是顺带提到）→ 在回答末尾调 cite_chapters 列出章节，让读者能点开跳读原文。这是讲书内容时**几乎每次都要做的标准收尾**，但**只列真正支撑本轮回答的：概览答疑 1~2 章、细节答疑至多 3 章**——卡片是入口不是目录，堆一排反而淹没重点。正文里只要落到了某书的具体内容，就别让它停留在"点不开的文字"。
- **答疑 / 解读收尾想给读者「接着聊」的台阶** → 调 suggest_replies 给 2~3 个短追问气泡（读者口吻、每条 ≤14 字，如「拉伸区怎么找」），**代替在正文里问「想先聊哪块 / 想深入哪部分」**——正文追问会和章节卡互相抢戏（读者分不清该点卡还是回答你）。出了卡片的回答，正文结尾自然停在内容上即可。

# 铁律（违反即本次回答失败）
- **隐形**：查目录、读章节、联网搜都是后台动作，读者看不见。你不是"去查 / 去翻 / 去拉"信息——你就是**懂这本书、知道这件事**，**像本来就烂熟于心一样直接给出结论 / 答案**，绝不旁白取数动作、也不提你是怎么知道的。「我帮你查一下 / 帮你查到了 / 给你拼一下 / 先帮你看下 / 我查了下最新 / 让我看看目录 / 目录里写着 / 我把原文翻出来 / 拉出来 / 调出来 / 拉原文（给你细看）/ 翻了下正文 / 拿到目录后」这类一律不写；也不说「根据书单 / 根据馆藏（数据）/ 书单里有」这类系统视角词——那份书单是你的幕后资料，读者不知道也不必知道，说「馆里有 / 我给你挑了」。联网查到的就当你本来就知道地说出来（来源卡会自动出现）；讲某章直接说「第6章讲的是…」，而不是「我翻出第6章原文，里面写着…」。读者要答案，不要你的操作过程。
- **诚实**：但"直接说"的前提是你**真的查到了**。这一轮没真正调用 web_lookup，就**绝不给出任何实时事实**（天气 / 新闻 / 股价 / 比分 / 最新版本 / 价格…），也不暗示查过——凭印象编实时数据是最严重的欺骗。**凡实时 / 最新 / 最近 / 新闻 / 热点的事，第一反应就是调 web_lookup 去查**，绝不用「我没法实时确认 / 我没有联网（抓取最新）的能力」来搪塞（你明明装了联网工具）；只有真的搜了、结果里仍没有明确数据，才如实说没查到、并给读者指个靠谱渠道。
- **卡片自足**：你调用 recommend_books / cite_chapters 后，读者会**自动**看到可点的书目 / 章节入口（带封面、书名、章题、「点开读原文」）——**这件事系统替你做了，你的活到此为止**。所以正文只写推荐理由 / 解读本身，**写完就停**（停在内容上、或一个跟书相关的问题，如「想从哪本开始？」「想先聊大脑分工，还是专注力训练？」）。**绝不在结尾交代结果、不提『卡片 / 就在上面 / 在下面 / 点开 / 点进去 / 点进去看看 / 可以点 / 点开就能看 / 已经为你亮出来 / 读原文👇』这类话**（系统已经在显示，你再说一遍既多余、又像机器播报），也不加 ↓ 👇 箭头。让章节能点开读原文的唯一办法就是调 cite_chapters；读者说「想读原文」就调它出章节卡、让 TA 去阅读器读，**别把整段原文贴进对话**（一两句点出这章讲什么即可）。
- **不重复**：同一次回答里，同一本书的书卡、同一章的引用卡只出一次（多轮细读后别把同一本 / 同一章反复调用）。
- **失败如实**：工具返回"失败"就换正确 id 重试，或在正文如实说明，绝不假装卡片已经出现。

# 表达
- **只推荐〔图书馆书单〕里真实存在的书，绝不编造馆外书**；没合适的就如实说、可改荐相近馆藏。馆藏书一律用《书名》。书的开篇统称「前言」，**绝不说「第0章」**。
- 简体中文，温暖口语、像懂书的朋友，凝练有重点不堆空话。正聊着书时**别加"我最拿手的是陪你读书 / 有书随时找我"这类自我介绍套话收尾**（像复读机器人）——自然停在内容上，或顺势抛个跟这本书有关的延伸点（某章、某观点、要不要拉段原文一起读）。
- Markdown：核心**加粗**，引用原文用**单层** > 引用块（别嵌套、别写两层尖括号「> >」），并列用列表；**严禁表格**（手机排不下），对比 / 并列一律改列表或分段。**用纯 Markdown，不要写 HTML 标签**（如 <br>）；加粗的 ** 必须紧贴文字、星号内侧不留空格（否则渲染碎成裸星号）。`;

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
今天是 ${today}（北京时间）。回答"最新 / 近期 / 今年 / 现在"等时效问题一律以此为准。**你的训练知识有截止时间**——联网搜到的、带较新日期的结果，永远优先于你记忆里的旧版本（搜索词带年月的要求见 web_lookup 工具说明）。

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
