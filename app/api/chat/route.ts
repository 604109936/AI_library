// 智学 Agent「小涤」云函数（T2.2 变量注入 + T2.3 工具循环 + T2.4 真流式）
// 协议：默认 NDJSON 流式，每行一个事件：
//   {"t":"d","v":文本增量} {"t":"status","v":"翻开《某书》"} {"t":"recs","v":[book_id]}
//   {"t":"cites","v":[{b,c}]} {"t":"end"} {"t":"err","v":消息}
// body.stream === false 时返回一次性 JSON（脚本/调试用）。
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { streamChat, type MMMessage, type MMToolCall } from "@/lib/server/minimax";
import { buildSystem, getUid, libTitles } from "@/lib/server/agent";
import { AGENT_TOOLS, toolStatus, execTool, type ToolEvent } from "@/lib/server/tools";
import { getCompressed, maybeCompress } from "@/lib/server/compress";
import { maybeUpdateMemory } from "@/lib/server/memory";
import { makeThinkHint } from "@/lib/server/thinkhint";
import { rateLimit, limiterKey } from "@/lib/server/ratelimit";
import { cutSafe } from "@/lib/server/text";

export const runtime = "nodejs";
export const maxDuration = 120;

// 上下文窗口与压缩器对齐（compress.ts KEEP=40）：有压缩信息时按 compressed_until 动态裁剪，
// 无压缩（游客/新会话）时兜底取最近 40 条——窗口若小于 KEEP 会产生"既不在摘要也不在请求"的黑洞
const MAX_TURNS = 40;
const HARD_CAP = 64; // 绝对上限（防异常超长请求）
const MAX_CHARS = 4000; // 单条消息长度护栏
// 工具循环上限：M3 多步规划能力强（toc→多章细读→出卡是常态），联网搜索(T10)上线后还会再叠轮次；
// 5 轮经常掐在半路，上调到 8（仍是防失控护栏，正常对话远用不满）
const MAX_ROUNDS = 8;

type Emit = (e: { t: "d" | "status" | "end" | "err"; v?: string } | ToolEvent) => void;

// Agent 循环：模型流式产出 → 有工具调用则执行并回灌结果 → 直到纯文本收尾
async function runAgent(msgs: MMMessage[], uid: string | null, emit: Emit, signal?: AbortSignal, compressed?: string) {
  // 全请求统一时间预算：最坏路径 8 轮主循环 + 1 补救轮，若每次 streamChat 各吃满 120s，
  // 总和远超 maxDuration=120——平台硬杀产生"无 end/err 的截断流"。每轮超时取剩余预算，
  // 剩余不足时跳过新轮次/补救轮，把无声截流变成可控收尾
  const deadline = Date.now() + 105_000;
  const remain = () => deadline - Date.now();
  const roundTimeout = () => Math.min(120_000, Math.max(5_000, remain()));
  const system = await buildSystem(uid, compressed);
  const convo: MMMessage[] = [{ role: "system", content: system }, ...msgs];
  // 失配监测（T3 层②兜底）：累积用户可见正文 + 记录是否出过卡片事件
  let fullText = "";
  let emittedCard = false;
  const emitW: Emit = (e) => {
    if (e.t === "d" && typeof e.v === "string") fullText += e.v;
    if (e.t === "recs" || e.t === "cites" || e.t === "web") emittedCard = true; // web 来源卡也算卡（漏计会误触发兜底补荐书卡）
    emit(e);
  };
  // 最后一轮的 content：tool_calls 轮为原始全文（含 <think>），纯文本收尾轮为剥思考后的展示文本
  // （streamChat 仅在 tool_calls 事件随附 rawContent）。补救轮回灌只需"模型看到自己说过的话"，两种口径均可。
  let lastRaw = "";
  let usedReadChapter = false; // 本轮细读过章节原文：按铁律回答必须出引用卡（兜底信号之一）
  const thinkHint = makeThinkHint(); // 思考包装：跨轮共用（去重状态连续，提示不重复闪现）
  for (let round = 0; ; round++) {
    let raw = ""; // 本轮原始 content（含 <think>），工具循环回灌用
    let calls: MMToolCall[] | null = null;
    for await (const ev of streamChat(convo, { tools: AGENT_TOOLS, temperature: 0.7, signal, timeoutMs: roundTimeout() })) {
      if (ev.type === "delta") { raw += ev.text; emitW({ t: "d", v: ev.text }); }
      else if (ev.type === "think") {
        // 思考原文绝不直出：规则提取成 ≤20 字过程提示（status 事件），前端以水波纹呈现（T8）
        const h = thinkHint(ev.text);
        if (h) emitW({ t: "status", v: h });
      }
      else { calls = ev.calls; raw = ev.rawContent; }
    }
    lastRaw = raw;
    if (!calls?.length) break;
    if (round >= MAX_ROUNDS || remain() < 12_000) {
      // 轮次耗尽：纯出卡工具仍执行（正文可能已承诺"为你推荐/依据如下"，卡片是用户唯一点击入口），其余丢弃
      for (const c of calls) {
        if (c.function.name === "recommend_books" || c.function.name === "cite_chapters") {
          const { event } = await execTool(c.function.name, c.function.arguments);
          if (event) emitW(event);
        }
      }
      break;
    }
    // 思考链回灌（M 系 interleaved thinking 官方要求）：assistant 历史用原始 content（完整保留 <think>），
    // 而不是剥过思考的展示文本——否则模型每轮工具调用都丢掉上一轮的推理，显著降智。
    // 实测见 docs/delivery/evidence/T5/m3-format-probe.md（原样回灌被 API 接受）。
    convo.push({ role: "assistant", content: raw, tool_calls: calls });
    if (process.env.AGENT_DEBUG === "1") {
      console.log(`[agent-debug] 第${round + 1}轮回灌 assistant（前240字）：${raw.slice(0, 240).replace(/\n/g, "⏎")}`);
    }
    for (const c of calls) {
      emitW({ t: "status", v: await toolStatus(c.function.name, c.function.arguments) }); // 带书名：「翻开《认知觉醒》」
      const { result, event } = await execTool(c.function.name, c.function.arguments);
      if (event) emitW(event);
      // 细读真的拿到原文才置位：模型用幻觉章号连续失败时若仍置位，兜底会基于假前提
      // 误触发"必须出引用卡"补救轮——白烧一轮静默延迟，卡片依然出不来
      if (c.function.name === "read_chapter" && !result.startsWith("失败") && !result.startsWith("工具执行出错")) usedReadChapter = true;
      convo.push({ role: "tool", tool_call_id: c.id, content: result });
    }
  }
  // T3 层②兜底：三类失配信号都补救——① 正文承诺了卡片却没出（"承诺展示"语境正则，
  // 泛匹配 /卡片/ 会被"卡片笔记法"等合法话题误触发）；② 细读过章节原文作答却没出引用卡；
  // ③ 用户有推荐意图、正文也提了馆藏书名、却零卡片（模型在"此前推荐过"的历史下最易犯）。
  // 追加一轮"只许出卡"的补救调用；模型仍不调或调错则放弃（三层已尽力，记日志供排查）。
  const promisedCard = /(已|为你|帮你|下方|下面|上面|这张)[^。！？\n]{0,10}卡片|卡片[^。！？\n]{0,6}(已|展示|放|在下)/.test(fullText);
  let recMismatch = false;
  if (!emittedCard && !promisedCard && !usedReadChapter) {
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
    // 意图距离放宽到 12 字：「挑两本适合我现在读的书」这类自然表达中动词与"书"隔了 9 字（曾漏判）
    if (/推荐|荐书|[挑选找推][^。！？\n]{0,12}书|给我[^。！？\n]{0,12}书|什么书|哪本|书单|读什么|读哪|适合我[^。！？\n]{0,8}(读|看|听)/.test(lastUser)) {
      const titles = await libTitles().catch(() => [] as string[]);
      recMismatch = titles.some((t) => fullText.includes(`《${t}》`));
    }
  }
  if (!emittedCard && (promisedCard || usedReadChapter || recMismatch) && lastRaw && remain() > 15_000) {
    // 正文已定格，补救轮的 M3 思考期可达十几秒——给用户一个进行中的反馈，消除"答完又卡住"的观感
    emitW({ t: "status", v: "正在为你整理卡片" });
    convo.push({ role: "assistant", content: lastRaw });
    convo.push({
      role: "user",
      content: promisedCard
        ? "（系统校验：你刚才的回答里提到了卡片，但没有真实调用卡片工具，用户面前没有任何卡片。请立即调用 recommend_books 或 cite_chapters 补出对应卡片；只调用工具，不要输出文字。）"
        : usedReadChapter
          ? "（系统校验：你刚才细读了章节原文来回答，但没有调用 cite_chapters 展示依据的章节卡片，用户无法跳转原文。请立即调用 cite_chapters 列出你依据的章节；只调用工具，不要输出文字。）"
          : "（系统校验：用户请你推荐书，你在正文提到了馆藏书，但没有调用 recommend_books——用户面前没有可点击的卡片，正文书名点不了。请立即调用 recommend_books 补出你提到的馆藏书；只调用工具，不要输出文字。）",
    });
    // maxTokens 收紧：补救轮只许出卡不许说话，2048 足够 think+工具参数，砍掉无效文字 token
    for await (const ev of streamChat(convo, { tools: AGENT_TOOLS, temperature: 0.3, signal, timeoutMs: roundTimeout(), maxTokens: 2048 })) {
      if (ev.type === "tool_calls") {
        for (const c of ev.calls) {
          if (c.function.name === "recommend_books" || c.function.name === "cite_chapters") {
            const { event } = await execTool(c.function.name, c.function.arguments);
            if (event) emitW(event);
          }
        }
      }
    }
    if (!emittedCard) console.warn("[chat] 失配兜底未能补出卡片：", fullText.slice(-120));
  }
}

export async function POST(req: NextRequest) {
  let body: { messages?: { role?: string; content?: string }[]; stream?: boolean; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const startedAt = Date.now(); // 整请求起点：后台压缩/记忆任务按剩余预算决定是否还来得及跑
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const all: MMMessage[] = raw
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role as "user" | "assistant", content: cutSafe(m.content!, MAX_CHARS) }));
  const uid = await getUid(req.headers.get("authorization"));
  // 限流（T9 放宽）：登录 20 次/分 + 200 次/时（真实读者连续追问不该被打断）；
  // 游客按 IP 收紧到 8 次/分 + 40 次/时（无身份约束，防脚本滥刷烧 token）
  const lk = limiterKey(uid, req.headers.get("x-forwarded-for"));
  const [perMin, perHour] = uid ? [20, 200] : [8, 40];
  if (!rateLimit(`m:${lk}`, perMin, 60_000) || !rateLimit(`h:${lk}`, perHour, 3_600_000)) {
    return NextResponse.json({ error: "你问得好快呀——歇口气，一分钟后我们接着聊" }, { status: 429 });
  }
  // T4 单一会话：登录用户一律落在唯一会话 'main'（忽略请求里的 sessionId——旧客户端缓存的
  // sess-xxx 不再产生分叉，压缩/记忆都挂在 main 上）；游客无云端会话
  const sessionId = uid ? "main" : null;
  // 变量⑥：本会话更早对话的压缩摘要（T2.6；登录且会话存在才有）
  const comp = uid && sessionId ? await getCompressed(uid, sessionId).catch(() => ({ summary: undefined, until: 0 })) : { summary: undefined as string | undefined, until: 0 };
  // 裁剪：摘要覆盖 [0,until) → 只送 until 之后的消息；无压缩则取最近 MAX_TURNS 条
  const msgs = (comp.until > 0 && comp.until < all.length ? all.slice(comp.until) : all.slice(-MAX_TURNS)).slice(-HARD_CAP);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
    return NextResponse.json({ error: "缺少用户消息" }, { status: 400 });
  }
  const compressed = comp.summary;
  // 答完后台跑：上下文压缩 + 记忆更新（T7）。均 fire-and-forget 不阻塞流式回复（客户端零感知）；
  // waitUntil 托管防 serverless 响应关闭后实例冻结（本地 dev 无请求上下文则直接后台跑）
  const afterAnswer = () => {
    if (!uid || !sessionId) return;
    // 剩余预算 = maxDuration(120s) 减去回答本身耗时再留 5s 余量：长回答后预算不足时
    // 后台任务跳过本轮（而不是跑到一半被平台硬杀，白烧一次长调用且无日志）
    const budget = 115_000 - (Date.now() - startedAt);
    const p = maybeCompress(uid, sessionId, budget);
    const m = maybeUpdateMemory(uid, budget);
    try { waitUntil(p); waitUntil(m); } catch {}
  };

  // 一次性 JSON 模式（脚本验证/调试）
  if (body.stream === false) {
    try {
      let content = "";
      const events: ToolEvent[] = [];
      await runAgent(msgs, uid, (e) => {
        if (e.t === "d" && e.v) content += e.v;
        if (e.t === "recs" || e.t === "cites" || e.t === "web") events.push(e as ToolEvent);
      }, undefined, compressed);
      afterAnswer();
      return NextResponse.json({ content, events });
    } catch (e) {
      console.error("[/api/chat]", e);
      return NextResponse.json({ error: "我这边信号不太好，稍等片刻再来找我吧" }, { status: 502 });
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
          emit({ t: "err", v: "我这边信号不太好，稍等片刻再来找我吧" });
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
