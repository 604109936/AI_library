// 小涤的 5 个工具：推荐书目卡片 / 读取书本目录 / 读取章内容 / 引用章节卡片 / 联网搜索（T10）。
// 卡片类工具「触发即出卡」：服务端回事件（直带展示数据），前端按占位标记交错渲染。
import "server-only";
import { admin } from "@/lib/server/agent";
import { searchWeb, type WebHit } from "@/lib/server/websearch";
import { cutSafe } from "@/lib/server/text";
import { readOverride } from "@/lib/server/agentConfig";
import type { MMTool } from "@/lib/server/minimax";

// 工具执行中的等待文案（前端水波纹扫光呈现，不带省略号）：每个工具一句固定短语，对用户隐去工具本身。
export const TOOL_STATUS: Record<string, string> = {
  recommend_books: "为你挑书", // 是"呈现挑好的书"，不是"查找"——与卡片标题「为你挑的书」呼应
  read_book_toc: "翻阅图书",
  read_chapter: "细读原文", // 读整章原文：与 cite 区分开，别再共用笼统的「章节浏览」
  cite_chapters: "整理章节", // 出可点击的引用章节卡
  web_lookup: "联网搜索",
};

// 取工具的固定等待短语（不再带书名/章号——更简洁、也不暴露细节）；未知工具回落「思考中」。
export function toolStatus(name: string): string {
  return TOOL_STATUS[name] ?? "思考中";
}

export const AGENT_TOOLS: MMTool[] = [
  {
    type: "function",
    function: {
      name: "recommend_books",
      description:
        "展示「推荐书目」卡片——读者点进书的唯一入口（正文书名点不了）。【何时调用】① 读者求推荐 / 选书；② 馆藏书正好对症读者的困惑 / 需求 / 情绪 / 兴趣（如怎么提高专注力、老和家人吵架、最近很丧、想提升品味），你把那本书当答案引荐给 TA——**只要正文实质在向读者推荐某本馆藏书，就调**，写完理由后出卡。【勿调】读者问天气 / 新闻 / 闲聊等别的事、你只顺口提一句书时别调（会弹无关书卡＝答非所问）；前几轮已推过、本轮没再问起的书别重复弹。book_ids 取自〔图书馆书单〕的 [id]，按优先级 ≤5 本、不重复。",
      parameters: {
        type: "object",
        properties: { book_ids: { type: "array", items: { type: "string" }, description: "要推荐的书 id 列表（≤5 本）" } },
        required: ["book_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_book_toc",
      description:
        "读取某馆藏书的完整目录（各章标题 + 概要）。【何时调用】要做该书的答疑 / 解读前先调用，了解全书结构、定位该细读的章节。book_id 取自〔图书馆书单〕的 [id]。",
      parameters: {
        type: "object",
        properties: { book_id: { type: "string", description: "书 id，来自〔图书馆书单〕的 [id]" } },
        required: ["book_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_chapter",
      description:
        "读取某一章的完整原文。【何时调用】要引用 / 细究 / 解读某章具体内容时调用，据原文讲准，别凭记忆编章节细节。chapter_no：0 = 前言，1 起为正文。",
      parameters: {
        type: "object",
        properties: {
          book_id: { type: "string" },
          chapter_no: { type: "integer", description: "章序号（0=前言，1 起为正文章节）" },
        },
        required: ["book_id", "chapter_no"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cite_chapters",
      description:
        "展示可点击的「引用章节」卡片——让章节能跳读原文的**唯一方式**。【何时调用】凡正文讲到某馆藏书的内容 / 观点 / 情节 / 人物 / 某一章（答疑、解读、或顺带讲到都算）→ 末尾调用列出相关章节，让读者跳读原文。这是讲书内容**几乎每次都要做的收尾**，宁多列别漏。正文写「点进去跳读原文」而不调用＝点不了的空话。items ≤4、同一章不重复。",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: { type: "object", properties: { book_id: { type: "string" }, chapter_no: { type: "integer" } }, required: ["book_id", "chapter_no"] },
            description: "引用的章节列表（≤4 个）",
          },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_lookup",
      description:
        "联网获取互联网实时公开信息。【必须调用】① 读者要你联网 / 上网 / 查最新；② 实时 / 时效内容（天气、新闻、热搜、股价 / 汇率 / 油价 / 金价、赛事比分、票房、最新版本 / 型号 / 价格、谁刚获奖、当下日期等）；③ 读书之外、需事实查证、超出你知识截止的提问。**先查到再答，绝不凭印象编实时数据。**【勿用】馆藏书内容 / 读书方法 / 个性化推荐等馆内问题走你的理解，不联网。【query】精炼中文关键词；问「最新」务必带当前年月（如「{当前年月} …」），以搜到的带日期新结果为准、别拿训练记忆当最新。结果来源卡由系统展示。",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "搜索关键词（精炼、中文优先）" } },
        required: ["query"],
      },
    },
  },
];

// 运行时构建工具组：每个工具的 description 可被后台在线覆盖（参数 schema 固定不变）。
// route 改用本函数取代直接引用 AGENT_TOOLS——这样后台改描述即时生效。
export async function getAgentTools(): Promise<MMTool[]> {
  const ov = await readOverride();
  const desc = ov.toolDescriptions ?? {};
  // 工具描述里的「{当前年月}」占位符动态填真值（与系统提示词〔今天的日期〕同源）：跨月后联网示例不再钉死在旧月份
  const ym = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long" }).format(new Date());
  return AGENT_TOOLS.map((t) => {
    const base = desc[t.function.name]?.trim() ? desc[t.function.name]! : t.function.description;
    return { ...t, function: { ...t.function, description: base.replace(/\{当前年月\}/g, ym) } };
  });
}

// 卡片事件直带展示数据（T3 加固）：recs 带 {id,title,author,封面种子cs,封面图cv}——前端零查询直接成完整卡片；
// cites 直带 书名/章题/snippet——前端不再为 60 字摘要拉整本书正文（原性能黑洞），也消除"拉数据失败丢卡"失配；
// web 直带来源列表（标题/链接/日期），前端渲染「来源」卡组（T10）
export type ToolEvent =
  | { t: "recs"; v: { id: string; title: string; author: string; cv: string; cs: number }[] }
  | { t: "cites"; v: { b: string; c: number; bt: string; ct: string; sn: string; cs: number; cv: string }[] }
  | { t: "web"; v: { q: string; items: { t: string; u: string; d: string }[] } };

export async function execTool(name: string, argsJson: string): Promise<{ result: string; event?: ToolEvent }> {
  let args: any = {};
  try { args = JSON.parse(argsJson || "{}"); } catch {}
  try {
    if (name === "recommend_books") {
      const ids: string[] = Array.isArray(args.book_ids) ? args.book_ids.map(String) : [];
      // 直带 作者/封面种子/封面图：前端零查询即可成完整卡片（不再二次 getBook 拉书目），
      // 彻底消除"降级空封面"与富化竞态——谁的封面都不会缺
      const { data } = await admin.from("books").select("id,title,author,cover_url,cover_seed").in("id", ids);
      // 必须按模型传入的顺序重排：.in() 返回行序是 DB 扫描序，与推荐优先级无关——
      // 正文说"最推荐第一本《A》"而卡组第一张是《B》即失配；超 5 本时砍掉的也该是模型排最后的
      const order = new Map<string, number>();
      ids.forEach((id, i) => { if (!order.has(id)) order.set(id, i); }); // 重复 id 取首次出现的下标，保留模型本意的优先级，不被后写覆盖反转
      const valid = (data ?? [])
        .sort((a: any, b: any) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
        .slice(0, 5);
      if (!valid.length) return { result: "失败：这些 book_id 在馆藏中不存在，卡片没有展示。请用〔图书馆书单〕里的 [id] 重试；若不重试，正文中不得提及卡片。" };
      return {
        result: `已收到。若你已把推荐理由讲完，**本轮就此结束、不要再从头重讲一遍**；若还没讲完，简短补完即止。别复述书名清单，也别出现"卡片 / 入口 / 已展示 / 已备好 / 点开 / 跳到 / 在上面 / 在下面 / 👇 / ↓"等任何字样——读者会自动看到可点书目，无需你交代。`,
        event: { t: "recs", v: valid.map((b: any) => ({ id: b.id, title: b.title, author: b.author ?? "", cv: b.cover_url ?? "", cs: b.cover_seed ?? 1 })) },
      };
    }
    if (name === "read_book_toc") {
      const id = String(args.book_id ?? "");
      // 不再整本书正文进内存：原 select 含 content 是为"概要缺失时取开头 60 字"，却把全书每章
      // 正文（30 章 × 1.5 万字级）拉穿 DB→函数。改两步：先拉轻量列，仅对缺概要的章补拉正文
      const [bookR, chapR] = await Promise.all([
        admin.from("books").select("id,title,author,tags,ai_digest").eq("id", id).maybeSingle(),
        admin.from("chapters").select("no,title,ai_summary").eq("book_id", id).order("no"),
      ]);
      const b: any = bookR.data;
      if (!b) return { result: `失败：馆藏中没有 book_id=${id} 的书。` };
      const chaps = (chapR.data ?? []) as any[];
      const missing = chaps.filter((c) => !(c.ai_summary ?? "").trim()).map((c) => c.no);
      const headOf = new Map<number, string>();
      if (missing.length) {
        const { data: extra } = await admin.from("chapters").select("no,content").eq("book_id", id).in("no", missing);
        for (const c of (extra ?? []) as any[]) headOf.set(c.no, cutSafe(String(c.content ?? ""), 60));
      }
      const lines = chaps.map(
        // 第 0 章即前言：标「前言《标题》」而非「第0章《标题》」（突兀），模型据此也不会在正文说"第0章"
        (c) => `${c.no === 0 ? `前言《${c.title}》` : `第${c.no}章《${c.title}》`}：${(c.ai_summary ?? "").trim() || `（${c.no === 0 ? "前言，" : ""}无概要，开头：${headOf.get(c.no) ?? ""}（后略））`}`
      );
      return { result: `《${b.title}》（${b.author}｜${(b.tags ?? []).join("/")}）\n全书概要：${b.ai_digest ?? "无"}\n目录（共 ${lines.length} 章）：\n${lines.join("\n")}` };
    }
    if (name === "read_chapter") {
      const id = String(args.book_id ?? "");
      const no = Number(args.chapter_no);
      // 取整章正文（最多 15000 字）是工具循环里最重的一笔查询：挂 8s 硬超时，防 DB 网络 stall 顶穿 maxDuration 产生无 end 截断流
      const { data: c } = await admin.from("chapters").select("no,title,content").eq("book_id", id).eq("no", no).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
      if (!c) return { result: `失败：${id} 没有第 ${no} 章。可先用 read_book_toc 查目录。` };
      const content = String((c as any).content ?? "");
      // 第 0 章即前言：与 read_book_toc 同口径标「前言《标题》」而非「第0章《…》」，免得模型照搬"第0章"进正文
      const cno = (c as any).no;
      const label = cno === 0 ? `前言《${(c as any).title}》` : `第${cno}章《${(c as any).title}》`;
      return { result: `${label}完整原文：\n${cutSafe(content, 15000)}${content.length > 15000 ? "\n（后文略）" : ""}` };
    }
    if (name === "cite_chapters") {
      const items: { book_id?: unknown; chapter_no?: unknown }[] = Array.isArray(args.items) ? args.items : [];
      const valid: { b: string; c: number; bt: string; ct: string; sn: string; cs: number; cv: string }[] = [];
      for (const it of items.slice(0, 4)) {
        const b = String(it.book_id ?? "");
        const c = Number(it.chapter_no);
        // 展示数据一次取齐：书名/封面 + 章题/开头 60 字（前端原来为这点数据拉整本书正文）
        const [bookR, chapR] = await Promise.all([
          admin.from("books").select("title,cover_url,cover_seed").eq("id", b).maybeSingle(),
          admin.from("chapters").select("no,title,content").eq("book_id", b).eq("no", c).maybeSingle(),
        ]);
        const bk: any = bookR.data;
        const ch: any = chapR.data;
        if (bk && ch) {
          valid.push({
            b, c,
            bt: bk.title,
            ct: ch.title,
            sn: cutSafe(String(ch.content ?? "").replace(/\s+/g, " ").trim(), 60),
            cs: bk.cover_seed ?? 1,
            cv: bk.cover_url ?? "",
          });
        }
      }
      if (!valid.length) return { result: "失败：引用的章节不存在，卡片没有展示。请核对 book_id 与 chapter_no 后重试；若不重试，正文中不得提及卡片。" };
      return { result: "已收到。若你已把这章讲清，**本轮就此结束**；若还没讲，一两句点出讲什么即可。别把整段原文贴进对话，也别出现\"卡片 / 入口 / 已展示 / 点开 / 在下面 / 👇 / ↓\"等任何字样——读者会自动看到可点章节，无需你交代。", event: { t: "cites", v: valid } };
    }
    if (name === "web_lookup") {
      const q = cutSafe(String(args.query ?? "").trim(), 60);
      if (!q) return { result: "失败：缺少搜索关键词 query。" };
      const hits: WebHit[] = await searchWeb(q);
      if (!hits.length) return { result: `联网搜索「${q}」没有找到结果。可换个关键词重试，或如实告诉读者没查到。` };
      const lines = hits.map((h, i) => `${i + 1}. ${h.title}${h.date ? `（${h.date}）` : ""}\n   ${h.snippet}\n   来源：${h.link}`);
      return {
        result: `以下是联网搜索「${q}」的结果——**能回答用户问题的就用它来作答，与问题无关 / 答非所问的条目直接忽略、别硬凑**（搜索难免夹带不相关结果，挑对的用才靠谱）。综合作答即可、不必罗列链接，也别提「来源卡 / 卡片 / 已展示」。**若这些结果里压根没有能回答问题的明确数据**（如具体气温 / 价格 / 比分 / 指数值），就如实告诉用户没查到准确数据、建议去对应渠道看，**绝不从无关报道里编出具体数字**：\n${lines.join("\n")}`,
        event: { t: "web", v: { q, items: hits.map((h) => ({ t: h.title, u: h.link, d: h.date })) } },
      };
    }
    return { result: `失败：未知工具 ${name}。` };
  } catch (e) {
    // 数据库/搜索服务抖动等异常：卡片必然没出。明确告知模型，防止它在正文里假装"已展示"
    return { result: `工具执行出错（卡片未展示，正文中不得提及卡片）：${e instanceof Error ? e.message : "未知错误"}` };
  }
}
