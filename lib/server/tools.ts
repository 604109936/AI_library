// 小涤的 4 个工具（T2.3）：推荐书目卡片 / 读取书本目录 / 读取章内容 / 引用章节卡片。
// 卡片类工具「触发即出卡」：服务端只回 book_id(+章序号) 事件，前端收信号后自行拉取展示数据。
import "server-only";
import { admin } from "@/lib/server/agent";
import type { MMTool } from "@/lib/server/minimax";

// 工具执行中的等待文案：要有"它真的在替我翻书"的画面感（UI Review C16）。
// T8：进行感由前端水波纹扫光传达，文案一律不带省略号
export const TOOL_STATUS: Record<string, string> = {
  recommend_books: "在书架间为你找书",
  read_book_toc: "翻开这本书",
  read_chapter: "细读章节",
  cite_chapters: "整理原文出处",
};

// 状态文案带书名：「翻开《认知觉醒》」比「翻开这本书」更有"它真的在替我翻书"的实感。
// 查询失败/参数缺失时回落通用文案；书名查询极轻（主键单行），不拖慢工具执行
export async function toolStatus(name: string, argsJson: string): Promise<string> {
  const base = TOOL_STATUS[name] ?? "查阅资料";
  if (name !== "read_book_toc" && name !== "read_chapter") return base;
  try {
    const args = JSON.parse(argsJson || "{}");
    const id = String(args.book_id ?? "");
    if (!id) return base;
    const { data } = await admin.from("books").select("title").eq("id", id).maybeSingle();
    const title = (data as any)?.title;
    if (!title) return base;
    if (name === "read_book_toc") return `翻开《${title}》`;
    const no = Number(args.chapter_no);
    return Number.isFinite(no) ? (no === 0 ? `细读《${title}》前言` : `细读《${title}》第${no}章`) : `细读《${title}》`;
  } catch {
    return base;
  }
}

export const AGENT_TOOLS: MMTool[] = [
  {
    type: "function",
    function: {
      name: "recommend_books",
      description: "向用户展示「推荐书目」卡片。当你决定推荐馆藏书时调用；先在正文解释推荐理由，再调用本工具。book_ids 必须来自〔图书馆书单〕中的 [id]。",
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
      description: "读取某本馆藏书的完整目录（每章标题与概要）。做书本答疑、解读原文前，先用它了解全书结构、确定要细读哪一章。",
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
      description: "读取某一章的完整原文。回答涉及具体内容、需要引用原文时调用。",
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
      description: "向用户展示「引用章节」卡片（可点击跳转原文）。当你的回答依据了具体章节内容时，在回答末尾调用，列出依据的章节。",
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
];

// 卡片事件直带展示数据（T3 加固）：recs 带 {id,title} 供前端拉不到完整书目时降级渲染保底可点；
// cites 直带 书名/章题/snippet——前端不再为 60 字摘要拉整本书正文（原性能黑洞），也消除"拉数据失败丢卡"失配
export type ToolEvent =
  | { t: "recs"; v: { id: string; title: string }[] }
  | { t: "cites"; v: { b: string; c: number; bt: string; ct: string; sn: string; cs: number; cv: string }[] };

export async function execTool(name: string, argsJson: string): Promise<{ result: string; event?: ToolEvent }> {
  let args: any = {};
  try { args = JSON.parse(argsJson || "{}"); } catch {}
  try {
    if (name === "recommend_books") {
      const ids: string[] = Array.isArray(args.book_ids) ? args.book_ids.map(String) : [];
      const { data } = await admin.from("books").select("id,title").in("id", ids);
      const valid = (data ?? []).slice(0, 5);
      if (!valid.length) return { result: "失败：这些 book_id 在馆藏中不存在，卡片没有展示。请用〔图书馆书单〕里的 [id] 重试；若不重试，正文中不得提及卡片。" };
      return {
        result: `推荐卡片已展示给用户：${valid.map((b: any) => `《${b.title}》`).join("、")}。正文中自然衔接即可，不要再重复罗列书名清单。`,
        event: { t: "recs", v: valid.map((b: any) => ({ id: b.id, title: b.title })) },
      };
    }
    if (name === "read_book_toc") {
      const id = String(args.book_id ?? "");
      const [bookR, chapR] = await Promise.all([
        admin.from("books").select("id,title,author,tags,ai_digest").eq("id", id).maybeSingle(),
        admin.from("chapters").select("no,title,ai_summary,content").eq("book_id", id).order("no"),
      ]);
      const b: any = bookR.data;
      if (!b) return { result: `失败：馆藏中没有 book_id=${id} 的书。` };
      const lines = ((chapR.data ?? []) as any[]).map(
        (c) => `第${c.no}章《${c.title}》：${(c.ai_summary ?? "").trim() || `（${c.no === 0 ? "前言，" : ""}无概要，开头：${String(c.content ?? "").slice(0, 60)}（后略））`}`
      );
      return { result: `《${b.title}》（${b.author}｜${(b.tags ?? []).join("/")}）\n全书概要：${b.ai_digest ?? "无"}\n目录（共 ${lines.length} 章）：\n${lines.join("\n")}` };
    }
    if (name === "read_chapter") {
      const id = String(args.book_id ?? "");
      const no = Number(args.chapter_no);
      const { data: c } = await admin.from("chapters").select("no,title,content").eq("book_id", id).eq("no", no).maybeSingle();
      if (!c) return { result: `失败：${id} 没有第 ${no} 章。可先用 read_book_toc 查目录。` };
      const content = String((c as any).content ?? "");
      return { result: `第${(c as any).no}章《${(c as any).title}》完整原文：\n${content.slice(0, 15000)}${content.length > 15000 ? "\n（后文略）" : ""}` };
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
            sn: String(ch.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
            cs: bk.cover_seed ?? 1,
            cv: bk.cover_url ?? "",
          });
        }
      }
      if (!valid.length) return { result: "失败：引用的章节不存在，卡片没有展示。请核对 book_id 与 chapter_no 后重试；若不重试，正文中不得提及卡片。" };
      return { result: "引用章节卡片已展示给用户。", event: { t: "cites", v: valid } };
    }
    return { result: `失败：未知工具 ${name}。` };
  } catch (e) {
    // 数据库抖动等异常：卡片必然没出。明确告知模型，防止它在正文里假装"已展示"
    return { result: `工具执行出错（卡片未展示，正文中不得提及卡片）：${e instanceof Error ? e.message : "未知错误"}` };
  }
}
