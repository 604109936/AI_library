// 智学 Agent「小涤」云函数（T2.2 变量注入 + T2.3 工具循环 + T2.4 真流式）
// 协议：默认 NDJSON 流式，每行一个事件：
//   {"t":"d","v":文本增量} {"t":"status","v":"翻开《某书》"} {"t":"recs","v":[book_id]}
//   {"t":"cites","v":[{b,c}]} {"t":"end"} {"t":"err","v":消息}
// body.stream === false 时返回一次性 JSON（脚本/调试用）。
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { streamChat, type MMMessage, type MMToolCall } from "@/lib/server/minimax";
import { buildSystem, getUid } from "@/lib/server/agent";
import { getAgentTools, toolStatus, execTool, type ToolEvent } from "@/lib/server/tools";
import { readOverride, DEFAULT_MAIN_MAX_TOKENS, DEFAULT_CHAT_MODEL } from "@/lib/server/agentConfig";
import { getCompressed, maybeCompress } from "@/lib/server/compress";
import { maybeUpdateMemory } from "@/lib/server/memory";
import { rateLimit, limiterKey } from "@/lib/server/ratelimit";
import { cutSafe } from "@/lib/server/text";

export const runtime = "nodejs";
export const maxDuration = 120;

// 上下文窗口与压缩器对齐（compress.ts KEEP=40）：摘要覆盖 [0,until)，请求窗口起点绝不能越过 until，
// 否则 [until, start) 既不在摘要也不在请求 = 上下文黑洞（Bug#2）。仅在未压缩段超长时从尾部兜底截断。
const HARD_CAP = 64; // 未压缩段窗口上限（防异常超长请求；正常对话 + 压缩跟进时整段未压缩消息都在窗内）
const MAX_CHARS = 4000; // 单条消息长度护栏
// 工具循环上限：M3 多步规划能力强（toc→多章细读→出卡是常态），联网搜索(T10)上线后还会再叠轮次；
// 5 轮经常掐在半路，上调到 8（仍是防失控护栏，正常对话远用不满）
const MAX_ROUNDS = 8;

type Emit = (e: { t: "d" | "status" | "end" | "err"; v?: string } | ToolEvent) => void;

// Agent 循环：模型流式产出 → 有工具调用则执行并回灌结果 → 直到纯文本收尾
// 纯「提示词 + 工具描述 + 主动编排」驱动（用户决策：取消所有反应式兜底）。保留的「编排」＝ 实时问题首轮强制联网防幻觉、
// 跑题荐书卡拦截、卡片去重、工具水波纹、轮次护栏；已删除 空回复重试 / 卡片失配补救 / web 失配补救 等反应式补救轮。
async function runAgent(msgs: MMMessage[], uid: string | null, emit: Emit, signal?: AbortSignal, compressed?: string) {
  // 统一时间预算：最坏 MAX_ROUNDS 轮，每轮按剩余预算定超时，剩余不足即收尾，避免顶穿 maxDuration 产生无声截断流。
  const deadline = Date.now() + 105_000;
  const remain = () => deadline - Date.now();
  const roundTimeout = () => Math.min(120_000, Math.max(5_000, remain()));
  const system = await buildSystem(uid, compressed);
  // 后台可调配置：模型/温度/工具描述（缺省回退出厂值）。tools 内部已合并描述覆盖
  const [ov, tools] = await Promise.all([readOverride(), getAgentTools()]);
  const mainTemp = typeof ov.temperature === "number" ? ov.temperature : 0.7;
  const mainMax = typeof ov.mainMaxTokens === "number" ? ov.mainMaxTokens : DEFAULT_MAIN_MAX_TOKENS; // 主 Agent 生成上限（后台可调）
  // 智学对话模型：默认 Claude Sonnet 4.6（非 thinking，经 vtok.ai）；agentConfig.model 可在线覆盖。minimax.ts 按模型名路由到对应 provider。
  const chatModel = typeof ov.model === "string" && ov.model.trim() ? ov.model : DEFAULT_CHAT_MODEL;
  const convo: MMMessage[] = [{ role: "system", content: system }, ...msgs];
  // 同一条回答内卡片去重：模型多轮工具循环（toc→细读→出卡）时常把同一本书 / 同一章重复调用，前端会叠出多张
  // 一模一样的卡。按 书id / 书-章 维度过滤，重复项不再下发；整组都重复则整事件丢弃。跨「下一条提问」是新一次
  // runAgent、集合重置，再次推荐同一本照常出卡——只压住「同一条回答里」的重复。
  const seenRecs = new Set<string>();
  const seenCites = new Set<string>();
  const dedupeCard = (e: ToolEvent): ToolEvent | null => {
    if (e.t === "recs") {
      const v = e.v.filter((x) => x.id && !seenRecs.has(x.id));
      v.forEach((x) => seenRecs.add(x.id));
      return v.length ? { t: "recs", v } : null;
    }
    if (e.t === "cites") {
      const v = e.v.filter((x) => { const k = `${x.b}-${x.c}`; if (seenCites.has(k)) return false; seenCites.add(k); return true; });
      return v.length ? { t: "cites", v } : null;
    }
    return e; // web 来源卡不去重
  };
  // 实时事实问句（强制联网）且无荐书意图时，丢弃模型答完顺手弹的跑题荐书卡（问天气/新闻却弹上一轮的书卡＝答非所问）。
  let suppressRecs = false;
  let gotText = false; // 本次是否吐出过任何可见正文（用于"全空才补一轮"的兜住，见循环后）
  const emitW: Emit = (e) => {
    if (e.t === "d") { if (typeof e.v === "string" && e.v.trim()) gotText = true; emit(e); return; }
    if (e.t === "recs" || e.t === "cites" || e.t === "web") {
      if (e.t === "recs" && suppressRecs) return;
      const de = dedupeCard(e);
      if (de) emit(de); // 整组都是重复卡则丢弃不下发
      return;
    }
    emit(e);
  };
  // ── 主动编排：仅「明确要联网 / 明确的实时外部事实问句」才首轮强制联网（防模型凭印象编天气/财经/赛事数据）。
  //    刻意收窄、不滥搜——馆内问题、读书方法、能凭知识答的，都不强制，交模型按提示词自行判断该不该搜。──
  const lastUserText = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const explicitWeb = /联网|上网|网上|百度|谷歌|google|查最新|搜最新|查实时|查一下|搜一下|帮我查|帮我搜|search/i.test(lastUserText);
  // 「实时外部事实问句」——这些名词（天气/财经/赛事/新闻/时事/最新得主…）永远不是馆藏书，命中即高精度、安全强制
  const needsLiveQ =
    /天气(怎么样|如何|预报|状况|好不好|咋样|情况)/.test(lastUserText) ||
    /(股价|股市|大盘|指数|汇率|油价|金价|票房|比分|赛果|赛况|热搜|疫情)[^。！？\n]{0,6}(多少|怎么样|如何|是多少|情况|查|看)/.test(lastUserText) ||
    /(今天|今日|现在|最新|实时|近期|最近|刚刚)[^。！？\n]{0,8}(新闻|热点|热搜|头条|股价|大盘|汇率|油价|金价|票房|比分|赛果|赛况|疫情)/.test(lastUserText) ||
    /(最新|最近)[^。！？\n]{0,10}(得主|获奖|冠军|夺冠|当选|榜单|排行榜|热点|新闻)/.test(lastUserText);
  const forceSearch0 = explicitWeb || needsLiveQ;
  // 荐书意图：纯实时事实问句（强制联网）且无荐书意图时，压住跑题荐书卡。
  const recIntent =
    /推荐|荐书|[挑选找推][^。！？\n]{0,12}书|给我[^。！？\n]{0,12}书|有(没有|什么|无)[^。！？\n]{0,12}书|值得[读看]|什么书|哪本|书单|读什么|读哪|换[^。！？\n]{0,4}本|别的方向|适合我[^。！？\n]{0,8}(读|看|听)/.test(lastUserText);
  suppressRecs = forceSearch0 && !recIntent;
  for (let round = 0; ; round++) {
    let raw = ""; // 本轮原始 content（含 <think>），工具循环回灌用
    let calls: MMToolCall[] | null = null;
    // 首轮对「天气/财经/赛事/新闻等实时事实问句、明确要联网」强制先调 web_lookup：本轮不外泄任何文字
    // （防"好，这就帮你查"漏出），拿到真实结果后下一轮再据实作答——从源头根治"凭印象编实时数据 + 谎称查过"。
    const forceWeb = round === 0 && forceSearch0;
    // 强制联网轮：一开始就亮「联网搜索」水波纹，别让用户先盯着几秒「思考中」再变——长搜索期间观感更安心
    if (forceWeb) emitW({ t: "status", v: toolStatus("web_lookup") });
    for await (const ev of streamChat(convo, { tools, temperature: mainTemp, model: chatModel, signal, timeoutMs: roundTimeout(), maxTokens: mainMax, ...(forceWeb ? { toolChoice: { type: "function" as const, function: { name: "web_lookup" } } } : {}) })) {
      if (ev.type === "delta") { raw += ev.text; if (!forceWeb) emitW({ t: "d", v: ev.text }); }
      else if (ev.type === "tool_calls") { calls = ev.calls; raw = ev.rawContent; }
      // think 事件忽略：思考过程对用户隐藏，等待期统一显示「思考中」水波纹
    }
    if (!calls?.length) break;
    if (round >= MAX_ROUNDS || remain() < 12_000) {
      // 轮次耗尽：纯出卡工具仍执行（正文可能已承诺"为你推荐/依据如下"，卡片是用户唯一点击入口），其余丢弃
      for (const c of calls) {
        if (c.function.name === "recommend_books" || c.function.name === "cite_chapters") {
          emitW({ t: "status", v: toolStatus(c.function.name) }); // 工具一触发就给对应水波纹（口径与主循环一致）
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
      emitW({ t: "status", v: toolStatus(c.function.name) }); // 每个工具一句固定短语（对用户隐去工具本身）
      const { result, event } = await execTool(c.function.name, c.function.arguments);
      if (event) emitW(event);
      convo.push({ role: "tool", tool_call_id: c.id, content: result });
    }
    // 展示卡片类工具（recommend_books/cite_chapters）是终端动作：本轮若已写出实质正文 + 出了卡，就此收尾、
    // 不再开下一轮——根治"模型调完卡片又在下一轮重写一遍收尾"导致的重复（实测 Claude 偶发改写式重复收尾）。
    // 仅当本轮没写正文（纯调卡片、把作答留到下一轮）才继续，让模型补出答案。
    const onlyCardTools = calls.every((c) => c.function.name === "recommend_books" || c.function.name === "cite_chapters");
    const visibleThisRound = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/\s/g, "");
    if (onlyCardTools && visibleThisRound.length > 15) break;
  }
  // 空回复兜住（唯一保留的 robustness——不靠正则猜模型哪错了，只是"模型打了个空嗝、零文字，就再问一次"）：
  // 模型/上游偶发返回全空（如 Claude 经代理瞬时抽风，或强制联网拿到结果后那轮恰好空），没这层会变成
  // "这次没说出话来"占位（实锤图：问天气却收到空白）。补一轮（最多2次，兼容补轮里再调工具→执行→作答）。
  if (!gotText && remain() > 9_000) {
    try {
      for (let r = 0; r < 2 && !gotText && remain() > 7_000; r++) {
        let rcalls: MMToolCall[] | null = null;
        let rraw = "";
        for await (const ev of streamChat(convo, { tools, temperature: mainTemp, model: chatModel, signal, timeoutMs: roundTimeout(), maxTokens: mainMax })) {
          if (ev.type === "delta") { rraw += ev.text; emitW({ t: "d", v: ev.text }); }
          else if (ev.type === "tool_calls") { rcalls = ev.calls; rraw = ev.rawContent; }
        }
        if (!rcalls?.length) break;
        convo.push({ role: "assistant", content: rraw, tool_calls: rcalls });
        for (const c of rcalls) {
          emitW({ t: "status", v: toolStatus(c.function.name) });
          const { result, event } = await execTool(c.function.name, c.function.arguments);
          if (event) emitW(event);
          convo.push({ role: "tool", tool_call_id: c.id, content: result });
        }
      }
    } catch (e) {
      console.warn("[chat] 空回复补轮异常：", e instanceof Error ? e.message : e);
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
  const [okMin, okHour] = await Promise.all([
    rateLimit(`m:${lk}`, perMin, 60_000),
    rateLimit(`h:${lk}`, perHour, 3_600_000),
  ]);
  if (!okMin || !okHour) {
    return NextResponse.json({ error: "你问得好快呀——歇口气，一分钟后我们接着聊" }, { status: 429 });
  }
  // T4 单一会话：登录用户一律落在唯一会话 'main'（忽略请求里的 sessionId——旧客户端缓存的
  // sess-xxx 不再产生分叉，压缩/记忆都挂在 main 上）；游客无云端会话
  const sessionId = uid ? "main" : null;
  // 变量⑥：本会话更早对话的压缩摘要（T2.6；登录且会话存在才有）
  const comp = uid && sessionId ? await getCompressed(uid, sessionId).catch(() => ({ summary: undefined, until: 0 })) : { summary: undefined as string | undefined, until: 0 };
  // 裁剪：摘要覆盖 [0,until) → 从 until 起送（无压缩则从会话起点起）。关键不变量：窗口起点不越过 until，
  // 保证 [until, len) 全部进入请求，杜绝"既不在摘要也不在请求"的黑洞（Bug#2）。仅当未压缩段本身超过
  // HARD_CAP（必伴随压缩滞后）才从尾部截断并记 warn 供观测——正常对话/压缩跟得上时不会触达。
  const ctxBase = comp.until > 0 && comp.until < all.length ? comp.until : 0;
  const tail = all.slice(ctxBase);
  // 防黑洞兜底：未压缩段超 HARD_CAP（必伴随压缩滞后）时，被尾部截掉的中段不能凭空丢失（否则既不在摘要
  // 也不在请求 = 上下文黑洞）。把中段折成原文片段拼进摘要通道，模型仍能看到那段大意，不再"失忆"。
  let compressed = comp.summary;
  let msgs = tail;
  if (tail.length > HARD_CAP) {
    const dropped = tail.slice(0, tail.length - HARD_CAP);
    msgs = tail.slice(-HARD_CAP);
    const droppedText = dropped.map((m) => `${m.role === "user" ? "读者" : "小涤"}：${cutSafe(m.content, 200)}`).join("\n");
    compressed = `${compressed ? compressed + "\n\n" : ""}〔更早对话（未及压缩，原文片段）〕\n${droppedText}`.slice(0, 8000);
    console.warn(`[chat] 未压缩段(${tail.length})超窗(${HARD_CAP})，压缩疑似滞后，中段${dropped.length}条折入摘要兜底`);
  }
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
    return NextResponse.json({ error: "缺少用户消息" }, { status: 400 });
  }
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
