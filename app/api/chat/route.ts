// 智学 Agent「小涤」云函数（T2.2 变量注入 + T2.3 工具循环 + T2.4 真流式）
// 协议：默认 NDJSON 流式，每行一个事件：
//   {"t":"d","v":文本增量} {"t":"status","v":"查找书籍…"} {"t":"recs","v":[book_id]}
//   {"t":"cites","v":[{b,c}]} {"t":"end"} {"t":"err","v":消息}
// body.stream === false 时返回一次性 JSON（脚本/调试用）。
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { streamChat, type MMMessage, type MMToolCall } from "@/lib/server/minimax";
import { buildSystem, getUid } from "@/lib/server/agent";
import { AGENT_TOOLS, TOOL_STATUS, execTool, type ToolEvent } from "@/lib/server/tools";
import { getCompressed, maybeCompress } from "@/lib/server/compress";
import { rateLimit, limiterKey } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 120;

// 上下文窗口与压缩器对齐（compress.ts KEEP=40）：有压缩信息时按 compressed_until 动态裁剪，
// 无压缩（游客/新会话）时兜底取最近 40 条——窗口若小于 KEEP 会产生"既不在摘要也不在请求"的黑洞
const MAX_TURNS = 40;
const HARD_CAP = 64; // 绝对上限（防异常超长请求）
const MAX_CHARS = 4000; // 单条消息长度护栏
const MAX_ROUNDS = 5; // 工具循环上限（防失控）

type Emit = (e: { t: "d" | "status" | "end" | "err"; v?: string } | ToolEvent) => void;

// Agent 循环：模型流式产出 → 有工具调用则执行并回灌结果 → 直到纯文本收尾
async function runAgent(msgs: MMMessage[], uid: string | null, emit: Emit, signal?: AbortSignal, compressed?: string) {
  const system = await buildSystem(uid, compressed);
  const convo: MMMessage[] = [{ role: "system", content: system }, ...msgs];
  for (let round = 0; ; round++) {
    let text = "";
    let calls: MMToolCall[] | null = null;
    for await (const ev of streamChat(convo, { tools: AGENT_TOOLS, temperature: 0.7, signal })) {
      if (ev.type === "delta") { text += ev.text; emit({ t: "d", v: ev.text }); }
      else calls = ev.calls;
    }
    if (!calls?.length) break;
    if (round >= MAX_ROUNDS) {
      // 轮次耗尽：纯出卡工具仍执行（正文可能已承诺"为你推荐/依据如下"，卡片是用户唯一点击入口），其余丢弃
      for (const c of calls) {
        if (c.function.name === "recommend_books" || c.function.name === "cite_chapters") {
          const { event } = await execTool(c.function.name, c.function.arguments);
          if (event) emit(event);
        }
      }
      break;
    }
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
  let body: { messages?: { role?: string; content?: string }[]; stream?: boolean; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const all: MMMessage[] = raw
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content!.slice(0, MAX_CHARS) }));
  const uid = await getUid(req.headers.get("authorization"));
  // 限流（T5）：每人 10 次/分钟 且 80 次/小时（游客按 IP）。烧 LLM token 的口子必须有闸
  const lk = limiterKey(uid, req.headers.get("x-forwarded-for"));
  if (!rateLimit(`m:${lk}`, 10, 60_000) || !rateLimit(`h:${lk}`, 80, 3_600_000)) {
    return NextResponse.json({ error: "提问太频繁了，请稍作休息再来" }, { status: 429 });
  }
  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId.slice(0, 64) : null;
  // 变量⑥：本会话更早对话的压缩摘要（T2.6；登录且会话存在才有）
  const comp = uid && sessionId ? await getCompressed(uid, sessionId).catch(() => ({ summary: undefined, until: 0 })) : { summary: undefined as string | undefined, until: 0 };
  // 裁剪：摘要覆盖 [0,until) → 只送 until 之后的消息；无压缩则取最近 MAX_TURNS 条
  const msgs = (comp.until > 0 && comp.until < all.length ? all.slice(comp.until) : all.slice(-MAX_TURNS)).slice(-HARD_CAP);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
    return NextResponse.json({ error: "缺少用户消息" }, { status: 400 });
  }
  const compressed = comp.summary;
  // 答完后台检查是否需要压缩；waitUntil 托管防 serverless 冻结（本地 dev 无请求上下文则直接后台跑）
  const afterAnswer = () => {
    if (!uid || !sessionId) return;
    const p = maybeCompress(uid, sessionId);
    try { waitUntil(p); } catch {}
  };

  // 一次性 JSON 模式（脚本验证/调试）
  if (body.stream === false) {
    try {
      let content = "";
      const events: ToolEvent[] = [];
      await runAgent(msgs, uid, (e) => {
        if (e.t === "d" && e.v) content += e.v;
        if (e.t === "recs" || e.t === "cites") events.push(e as ToolEvent);
      }, undefined, compressed);
      afterAnswer();
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
        await runAgent(msgs, uid, emit, req.signal, compressed);
        emit({ t: "end" });
        afterAnswer();
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
