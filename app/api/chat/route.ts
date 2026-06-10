// 智学 Agent「小涤」云函数（T2.2 变量注入 + T2.3 工具循环 + T2.4 真流式）
// 协议：默认 NDJSON 流式，每行一个事件：
//   {"t":"d","v":文本增量} {"t":"status","v":"查找书籍…"} {"t":"recs","v":[book_id]}
//   {"t":"cites","v":[{b,c}]} {"t":"end"} {"t":"err","v":消息}
// body.stream === false 时返回一次性 JSON（脚本/调试用）。
import { NextRequest, NextResponse } from "next/server";
import { streamChat, type MMMessage, type MMToolCall } from "@/lib/server/minimax";
import { buildSystem, getUid } from "@/lib/server/agent";
import { AGENT_TOOLS, TOOL_STATUS, execTool, type ToolEvent } from "@/lib/server/tools";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TURNS = 20; // 上下文裁剪（T2.6 做压缩前的简单上限）
const MAX_CHARS = 4000; // 单条消息长度护栏
const MAX_ROUNDS = 5; // 工具循环上限（防失控）

type Emit = (e: { t: "d" | "status" | "end" | "err"; v?: string } | ToolEvent) => void;

// Agent 循环：模型流式产出 → 有工具调用则执行并回灌结果 → 直到纯文本收尾
async function runAgent(msgs: MMMessage[], uid: string | null, emit: Emit, signal?: AbortSignal) {
  const system = await buildSystem(uid);
  const convo: MMMessage[] = [{ role: "system", content: system }, ...msgs];
  for (let round = 0; ; round++) {
    let text = "";
    let calls: MMToolCall[] | null = null;
    for await (const ev of streamChat(convo, { tools: AGENT_TOOLS, temperature: 0.7, signal })) {
      if (ev.type === "delta") { text += ev.text; emit({ t: "d", v: ev.text }); }
      else calls = ev.calls;
    }
    if (!calls?.length || round >= MAX_ROUNDS) break;
    convo.push({ role: "assistant", content: text, tool_calls: calls });
    for (const c of calls) {
      emit({ t: "status", v: TOOL_STATUS[c.function.name] ?? "查阅资料…" });
      const { result, event } = await execTool(c.function.name, c.function.arguments);
      if (event) emit(event);
      convo.push({ role: "tool", tool_call_id: c.id, content: result });
    }
  }
}

export async function POST(req: NextRequest) {
  let body: { messages?: { role?: string; content?: string }[]; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const msgs: MMMessage[] = raw
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content!.slice(0, MAX_CHARS) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
    return NextResponse.json({ error: "缺少用户消息" }, { status: 400 });
  }
  const uid = await getUid(req.headers.get("authorization"));

  // 一次性 JSON 模式（脚本验证/调试）
  if (body.stream === false) {
    try {
      let content = "";
      const events: ToolEvent[] = [];
      await runAgent(msgs, uid, (e) => {
        if (e.t === "d" && e.v) content += e.v;
        if (e.t === "recs" || e.t === "cites") events.push(e as ToolEvent);
      });
      return NextResponse.json({ content, events });
    } catch (e) {
      console.error("[/api/chat]", e);
      return NextResponse.json({ error: "小涤暂时联系不上，请稍后重试" }, { status: 502 });
    }
  }

  // 流式（默认）
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (e) => { try { controller.enqueue(enc.encode(JSON.stringify(e) + "\n")); } catch {} };
      try {
        await runAgent(msgs, uid, emit, req.signal);
        emit({ t: "end" });
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError")) {
          console.error("[/api/chat]", e);
          emit({ t: "err", v: "小涤暂时联系不上，请稍后重试" });
        }
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no", // 关代理缓冲，保证逐块送达
    },
  });
}
