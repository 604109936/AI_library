// 小涤的 4 个工具（T2.3）：推荐书目卡片 / 读取书本目录 / 读取章内容 / 引用章节卡片。
// 卡片类工具「触发即出卡」：服务端只回 book_id(+章序号) 事件，前端收信号后自行拉取展示数据。
import "server-only";
import { admin } from "@/lib/server/agent";
import type { MMTool } from "@/lib/server/minimax";

// 工具执行中的等待文案：要有"它真的在替我翻书"的画面感（UI Review C16）
export const TOOL_STATUS: Record<string, string> = {
  recommend_books: "在书架间找书…",
  read_book_toc: "翻开这本书…",
  read_chapter: "细读章节…",
  cite_chapters: "整理出处…",
};

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

export type ToolEvent = { t: "recs"; v: string[] } | { t: "cites"; v: { b: string; c: number }[] };

export async function execTool(name: string, argsJson: string): Promise<{ result: string; event?: ToolEvent }> {
  let args: any = {};
  try { args = JSON.parse(argsJson || "{}"); } catch {}
  try {
    if (name === "recommend_books") {
      const ids: string[] = Array.isArray(args.book_ids) ? args.book_ids.map(String) : [];
      const { data } = await admin.from("books").select("id,title").in("id", ids);
      const valid = (data ?? []).slice(0, 5);
      if (!valid.length) return { result: "失败：这些 book_id 在馆藏中不存在，请用〔图书馆书单〕里的 [id] 重试。" };
      return {
        result: `推荐卡片已展示给用户：${valid.map((b: any) => `《${b.title}》`).join("、")}。正文中自然衔接即可，不要再重复罗列书名清单。`,
        event: { t: "recs", v: valid.map((b: any) => b.id) },
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
        (c) => `第${c.no}章《${c.title}》：${(c.ai_summary ?? "").trim() || `（${c.no === 0 ? "前言，" : ""}无概要，开头：${String(c.content ?? "").slice(0, 60)}…）`}`
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
      const valid: { b: string; c: number }[] = [];
      for (const it of items.slice(0, 4)) {
        const b = String(it.book_id ?? "");
        const c = Number(it.chapter_no);
        const { data } = await admin.from("chapters").select("no").eq("book_id", b).eq("no", c).maybeSingle();
        if (data) valid.push({ b, c });
      }
      if (!valid.length) return { result: "失败：引用的章节不存在，请核对 book_id 与 chapter_no。" };
      return { result: "引用章节卡片已展示给用户。", event: { t: "cites", v: valid } };
    }
    return { result: `失败：未知工具 ${name}。` };
  } catch (e) {
    return { result: `工具执行出错：${e instanceof Error ? e.message : "未知错误"}` };
  }
}
