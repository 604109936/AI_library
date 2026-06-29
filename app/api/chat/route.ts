// 智学 Agent「小涤」云函数（T2.2 变量注入 + T2.3 工具循环 + T2.4 真流式）
// 协议：默认 NDJSON 流式，每行一个事件：
//   {"t":"d","v":文本增量} {"t":"status","v":"翻开《某书》"} {"t":"recs","v":[book_id]}
//   {"t":"cites","v":[{b,c}]} {"t":"end"} {"t":"err","v":消息}
// body.stream === false 时返回一次性 JSON（脚本/调试用）。
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { streamChat, type MMMessage, type MMToolCall } from "@/lib/server/minimax";
import { buildSystem, getUid, libTitles } from "@/lib/server/agent";
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
async function runAgent(msgs: MMMessage[], uid: string | null, emit: Emit, signal?: AbortSignal, compressed?: string, noFallback = false) {
  // noFallback（仅本地测试经请求传入）：关掉首轮强制联网 + 卡片/web 事后兜底，用于测量"裸提示词"的一次成型表现，
  // 据此打磨提示词/工具描述到模型自己就能自然做对，而非靠代码兜底（兜底只作极少触发的保险）。生产恒为 false。
  // 全请求统一时间预算：最坏路径 8 轮主循环 + 1 补救轮，若每次 streamChat 各吃满 120s，
  // 总和远超 maxDuration=120——平台硬杀产生"无 end/err 的截断流"。每轮超时取剩余预算，
  // 剩余不足时跳过新轮次/补救轮，把无声截流变成可控收尾
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
  // 测试钩子：从主循环摘掉某工具，用于端到端验证对应兜底（逼出"该出没出"，看兜底是否强制补出）。
  // CHAT_TEST_NO_MAIN_WEBSEARCH=1 摘 web_search；CHAT_TEST_NO_MAIN_CITE=1 摘 cite_chapters。生产绝不设——兜底仍用完整 tools。
  const noMain = new Set(
    [
      process.env.CHAT_TEST_NO_MAIN_WEBSEARCH === "1" ? "web_search" : "",
      process.env.CHAT_TEST_NO_MAIN_CITE === "1" ? "cite_chapters" : "",
    ].filter(Boolean)
  );
  const mainTools = noMain.size ? tools.filter((t) => !noMain.has(t.function.name)) : tools;
  const convo: MMMessage[] = [{ role: "system", content: system }, ...msgs];
  // 失配监测（T3 层②兜底）：累积用户可见正文 + 记录是否出过卡片事件
  let fullText = "";
  let emittedCard = false;
  let usedWebSearch = false; // 本轮真正联网过（web 兜底据此判定"该搜没搜"）
  // 同一次回答内的卡片去重：模型多轮工具循环（toc→细读→出卡）、轮次耗尽补出、或失配兜底叠加时，
  // 常把同一本书 / 同一章重复调用 recommend_books / cite_chapters，前端会叠出多张一模一样的卡（实锤图：
  // 书卡章节卡重复推荐）。这里按 书id / 书-章 维度过滤，重复项不再下发；整组都重复则整事件丢弃
  // （此前已出过卡，emittedCard 仍为真，不会误触兜底）。跨「下一条提问」是新一次 runAgent、集合重置，
  // 再次推荐同一本书照常出卡——只压住「同一条回答里」的重复。
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
  const emitW: Emit = (e) => {
    if (e.t === "d" && typeof e.v === "string") { fullText += e.v; emit(e); return; }
    if (e.t === "recs" || e.t === "cites" || e.t === "web") {
      const de = dedupeCard(e);
      if (!de) return; // 整组都是重复卡：丢弃不下发，前端不再叠卡
      emittedCard = true; // web 来源卡也算卡（漏计会误触发兜底补荐书卡）
      if (de.t === "web") usedWebSearch = true;
      emit(de);
      return;
    }
    emit(e);
  };
  // ── 联网意图信号（loop 前算，供"首轮强制联网"用，从源头根治"凭印象编实时数据 + 谎称查过"）──
  const lastUserText = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const explicitWeb = /联网|上网|网上|百度|谷歌|google|查最新|搜最新|查实时|查一下|搜一下|帮我查|帮我搜|search/i.test(lastUserText);
  // 「实时外部事实问句」——这些名词（天气/财经/赛事/新闻/时事/最新得主…）永远不是馆藏书，命中即高精度、安全强制，覆盖多场景
  const needsLiveQ =
    /天气(怎么样|如何|预报|状况|好不好|咋样|情况)/.test(lastUserText) ||
    /(股价|股市|大盘|指数|汇率|油价|金价|票房|比分|赛果|赛况|热搜|疫情)[^。！？\n]{0,6}(多少|怎么样|如何|是多少|情况|查|看)/.test(lastUserText) ||
    /(今天|今日|现在|最新|实时|近期|最近|刚刚)[^。！？\n]{0,8}(新闻|热点|热搜|头条|股价|大盘|汇率|油价|金价|票房|比分|赛果|赛况|疫情)/.test(lastUserText) ||
    /(最新|最近)[^。！？\n]{0,10}(得主|获奖|冠军|夺冠|当选|榜单|排行榜|热点|新闻)/.test(lastUserText);
  // 时间词紧贴时效事实名词（较宽，仅用于"没出卡时"的事后兜底，不用于首轮强制，避免误触）
  const timeSensitive = /(今天|今日|现在|此刻|实时|当前|最新|最近|近期|今年|本周|这两天|这几天)[^。！？\n]{0,10}(天气|气温|温度|下雨|降雨|新闻|热搜|股价|股票|大盘|指数|汇率|油价|金价|价格|行情|比分|赛果|赛况|疫情|票房|上映|发布|榜单|排行|排名|消息|情况|进展|动态|实况)/.test(lastUserText);
  // 首轮强制联网：仅高精度信号（明确要联网 / 实时外部事实问句）才强制——先 web_search 拿真实结果、下一轮再据实作答，
  // 从源头杜绝模型凭印象编天气/财经/赛事等实时数据又谎称"帮你查到了"（实锤图）。更模糊的场景靠提示词 + 事后兜底覆盖。
  const forceSearch0 = !noFallback && (explicitWeb || needsLiveQ) && !noMain.has("web_search");
  // 最后一轮的 content：tool_calls 轮为原始全文（含 <think>），纯文本收尾轮为剥思考后的展示文本
  // （streamChat 仅在 tool_calls 事件随附 rawContent）。补救轮回灌只需"模型看到自己说过的话"，两种口径均可。
  let lastRaw = "";
  let usedReadChapter = false; // 本轮细读过章节原文：按铁律回答必须出引用卡（兜底信号之一）
  for (let round = 0; ; round++) {
    let raw = ""; // 本轮原始 content（含 <think>），工具循环回灌用
    let calls: MMToolCall[] | null = null;
    // 首轮对「天气/财经/赛事/新闻等实时事实问句、明确要联网」强制先调 web_search：本轮不外泄任何文字
    // （防"好，这就帮你查"漏出），拿到真实结果后下一轮再据实作答——从源头根治"凭印象编实时数据 + 谎称查过"。
    const forceWeb = round === 0 && forceSearch0;
    for await (const ev of streamChat(convo, { tools: mainTools, temperature: mainTemp, model: chatModel, signal, timeoutMs: roundTimeout(), maxTokens: mainMax, ...(forceWeb ? { toolChoice: { type: "function" as const, function: { name: "web_search" } } } : {}) })) {
      if (ev.type === "delta") { raw += ev.text; if (!forceWeb) emitW({ t: "d", v: ev.text }); }
      else if (ev.type === "tool_calls") { calls = ev.calls; raw = ev.rawContent; }
      // think 事件忽略：思考过程对用户隐藏，等待期统一显示「思考中」水波纹，不再把思考提取成动态过程提示
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
      emitW({ t: "status", v: toolStatus(c.function.name) }); // 每个工具一句固定短语（对用户隐去工具本身）
      const { result, event } = await execTool(c.function.name, c.function.arguments);
      if (event) emitW(event);
      // 细读真的拿到原文才置位：模型用幻觉章号连续失败时若仍置位，兜底会基于假前提
      // 误触发"必须出引用卡"补救轮——白烧一轮静默延迟，卡片依然出不来
      if (c.function.name === "read_chapter" && !result.startsWith("失败") && !result.startsWith("工具执行出错")) usedReadChapter = true;
      convo.push({ role: "tool", tool_call_id: c.id, content: result });
    }
    // 展示卡片类工具（recommend_books/cite_chapters）是终端动作：本轮若已写出实质正文 + 出了卡，就此收尾、
    // 不再开下一轮——根治"模型调完卡片又在下一轮重写一遍收尾"导致的重复（实测 Claude 偶发改写式重复收尾）。
    // 仅当本轮没写正文（纯调卡片、把作答留到下一轮）才继续，让模型补出答案。
    const onlyCardTools = calls.every((c) => c.function.name === "recommend_books" || c.function.name === "cite_chapters");
    const visibleThisRound = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/\s/g, "");
    if (onlyCardTools && visibleThisRound.length > 15) break;
  }
  // T3 层②兜底：三类失配信号都补救——① 正文承诺了卡片却没出（"承诺展示"语境正则，
  // 泛匹配 /卡片/ 会被"卡片笔记法"等合法话题误触发）；② 细读过章节原文作答却没出引用卡；
  // ③ 用户有推荐意图、正文也提了馆藏书名、却零卡片（模型在"此前推荐过"的历史下最易犯）。
  // 追加一轮"只许出卡"的补救调用；模型仍不调或调错则放弃（三层已尽力，记日志供排查）。
  const promisedCard = /(已|为你|帮你|下方|下面|上面|这张)[^。！？\n]{0,10}卡片|卡片[^。！？\n]{0,6}(已|展示|放|在下)/.test(fullText);
  // 承诺「可点章节/跳读原文」却没出引用卡：模型常说「点进去跳读原文 / 点下面章节 / 点下方卡片直接跳转」（实锤图）——
  // 这类不含"卡片"二字或动词不在白名单里，promisedCard 抓不到，必须单列。两条都覆盖：
  // ① 点击类动词（含「点下面/点这/点卡/戳/可点」等口语变体，收口到 click 义的 点X 组合、不收 bare「点」，
  //    避免 重点/观点/点出/点评 误命中）紧贴 原文/章节/跳读/跳转；② 原文/章节 紧跟「卡片/可点/点开」。
  const promisedJump =
    /(点击|点进|点开|点一下|点下|点这|点那|点它|点卡|戳|可点|直接点|去点)[^。！？\n]{0,8}(原文|章节|跳读|跳转)/.test(fullText) ||
    /(原文|章节|跳读)[^。！？\n]{0,6}(卡片|可点|点开|点进|点击)/.test(fullText);
  let recMismatch = false;
  if (!emittedCard && !promisedCard && !promisedJump && !usedReadChapter) {
    // 意图距离放宽到 12 字：「挑两本适合我现在读的书」这类自然表达中动词与"书"隔了 9 字（曾漏判）
    if (/推荐|荐书|[挑选找推][^。！？\n]{0,12}书|给我[^。！？\n]{0,12}书|有(没有|什么|无)[^。！？\n]{0,12}书|值得[读看]|什么书|哪本|书单|读什么|读哪|适合我[^。！？\n]{0,8}(读|看|听)/.test(lastUserText)) {
      const titles = await libTitles().catch(() => [] as string[]);
      recMismatch = titles.some((t) => fullText.includes(`《${t}》`));
    }
  }
  // 「该搜没搜」事后兜底信号：模型在正文里「自称查过网 / 给出实时结果」却根本没调用 web_search——最伤信任的欺骗
  // （实锤图：编出上海天气还说"帮你查一下…帮你查到了"）。检测这类自述，连同首轮该强制却没搜成的情况一并补一轮真实 web_search。
  const claimedWeb =
    /(上网|联网|连网|网上|网络上|互联网)[^。！？\n]{0,8}(查|搜|搜索|检索|查证|核实|找)/.test(fullText) ||
    /(查|搜|搜索|检索)(了一下|了下|过了|了|到了|到)?[^。！？\n]{0,6}(最新|实时|目前|现在|今天|今日)[^。！？\n]{0,8}(天气|气温|新闻|股价|价格|行情|消息|资讯|数据|动态|情况|得主|冠军)/.test(fullText) ||
    /(帮你|为你)?查(一下|到了?|过了?)[^。！？\n]{0,8}(天气|新闻|股价|价格|行情|最新)/.test(fullText) ||
    /搜索结果[^。！？\n]{0,4}(显示|表明|来看|如下|是)/.test(fullText) ||
    /根据[^。！？\n]{0,8}(网络|网上|最新搜索|联网)[^。！？\n]{0,6}(信息|资料|结果|消息|报道|数据)/.test(fullText);
  // 补救目标工具：兜底轮必须强制一个工具——不强制时模型在补救轮又「只说话不调用」，正是「说点下面卡片
  // 却没有下文」的根因（实锤图）。① 提到可点章节/读过原文 → cite_chapters；② 荐书失配 → recommend_books；
  // ③ 仅泛"卡片"无明确指向 → 据正文是否在谈章节/原文判别（谈章节→cite，否则→荐书），始终落到一个工具上。
  const citeSignal = promisedJump || usedReadChapter;
  const cardIsCite = /章节|原文|跳读|跳转|目录|这一章|第.{0,3}章/.test(fullText);
  const remedyTool: "cite_chapters" | "recommend_books" =
    citeSignal ? "cite_chapters" : recMismatch ? "recommend_books" : cardIsCite ? "cite_chapters" : "recommend_books";
  // 失配兜底解耦：卡片补救与 web 补救可在同一回答内各自触发（不再互斥 else-if）——既缺卡又谎称查过时两者都纠正。
  // web 块用补救前的 convo 快照另起分支(wc)，避免被卡片块追加的校验消息污染对话结构（连续 user 消息）。
  const remedyBase = convo.slice();
  if (!noFallback && !emittedCard && (promisedCard || promisedJump || usedReadChapter || recMismatch) && lastRaw && remain() > 15_000) {
    // 正文已定格，补救轮的 M3 思考期可达十几秒——给用户一个进行中的反馈，消除"答完又卡住"的观感。
    // 整段 try/catch：补救轮 streamChat 若上游超时(TimeoutError)/502，绝不能把已发完的正文降级成 err（与 web 兜底同口径）。
    try {
    emitW({ t: "status", v: "正在为你整理相关书目与章节" });
    convo.push({ role: "assistant", content: lastRaw });
    convo.push({
      role: "user",
      content:
        remedyTool === "cite_chapters"
          ? "（系统校验：你提到了可点击跳读原文的具体章节、或依据了章节原文来作答，却没有调用 cite_chapters——在正文里写「点进去跳读原文」「点下面章节」是无效的，用户面前根本没有可点的章节卡片。请立即调用 cite_chapters 列出你提到/依据的那几章（同一章只列一次）；只调用工具，不要输出文字。）"
          : "（系统校验：你的回答推荐 / 提到了馆藏书，却没有调用 recommend_books——用户面前没有可点击的书卡，正文里的书名点不了。请立即调用 recommend_books 补出对应馆藏书（同一本只出一次）；只调用工具，不要输出文字。）",
    });
    // 补救轮只许出卡不许说话：tool_choice 强制必调目标工具（根治"补救轮又只说话不调用"）；maxTokens 8192 给足 think
    for await (const ev of streamChat(convo, {
      tools, temperature: 0.3, model: chatModel, signal, timeoutMs: roundTimeout(), maxTokens: 8192,
      toolChoice: { type: "function" as const, function: { name: remedyTool } },
    })) {
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
    } catch (e) {
      // 补救轮失败（上游超时/502 等）只记日志：正文已完整发出，绝不降级为 err/truncated
      console.warn("[chat] 卡片失配补救异常：", e instanceof Error ? e.message : e);
    }
  }
  if (!noFallback && !usedWebSearch && (forceSearch0 || claimedWeb || (timeSensitive && !emittedCard)) && lastRaw && remain() > 18_000) {
    // web_search 兜底：该联网却没真联网（含模型谎称查过）。补一轮：强制 web_search 拿真实结果 → 再据结果作答。
    // 用 remedyBase 快照另起 wc 分支（与卡片补救解耦、互不污染）；全程 try/catch + 紧超时，绝不影响已发正文。
    try {
      emitW({ t: "status", v: "联网搜索" });
      const wc: MMMessage[] = [
        ...remedyBase,
        { role: "assistant", content: lastRaw },
        { role: "user", content: "（系统校验：这个问题需要联网核实实时信息、或你在回答里已声称\"查过网/查到了\"，但你并没有真正调用 web_search，用户面前没有任何真实搜索结果——这是在欺骗读者。请立即调用 web_search 拿到真实结果（结合上文推断该搜什么）；先只调用工具、不要输出文字。）" },
      ];
      // tool_choice 强制本轮必调 web_search（35s 紧超时：挂起也快速失败，不拖垮整请求）
      let calls2: MMToolCall[] | null = null;
      let raw2 = "";
      for await (const ev of streamChat(wc, {
        tools, temperature: 0.3, model: chatModel, signal,
        timeoutMs: Math.min(35_000, roundTimeout()), maxTokens: 8192, // 给足 think 空间，防思考烧光致 web_search 没吐出
        toolChoice: { type: "function", function: { name: "web_search" } },
      })) {
        if (ev.type === "tool_calls") { calls2 = ev.calls; raw2 = ev.rawContent; }
      }
      if (calls2?.length) {
        wc.push({ role: "assistant", content: raw2, tool_calls: calls2 });
        for (const c of calls2) {
          const { result, event } = await execTool(c.function.name, c.function.arguments);
          if (event) emitW(event);
          wc.push({ role: "tool", tool_call_id: c.id, content: result });
        }
        // 二次作答轮：不再以 usedWebSearch 门控（空结果时它恒为 false 会跳过纠正轮＝沉默沿用编造内容＝失信）。
        // 有真实结果→据此综合；搜索为空→据"没查到"如实纠正、撤回此前凭印象给的数值/结论。预算紧时降级短补救。
        if (!usedWebSearch) {
          wc.push({ role: "user", content: "（系统校验：上面的搜索没有可用结果。请如实、简短地告诉读者你没能查到实时数据，并明确撤回 / 不要沿用之前可能凭印象给出的具体数值或结论；一两句即可，绝不再编造。）" });
        }
        if (remain() > 8_000) {
          const corrMax = usedWebSearch && remain() > 12_000 ? mainMax : Math.min(1024, mainMax);
          for await (const ev of streamChat(wc, { tools, temperature: mainTemp, model: chatModel, signal, timeoutMs: roundTimeout(), maxTokens: corrMax })) {
            if (ev.type === "delta") emitW({ t: "d", v: ev.text });
            else if (ev.type === "tool_calls") for (const c of ev.calls) { const { event } = await execTool(c.function.name, c.function.arguments); if (event) emitW(event); }
          }
        }
      }
      if (!usedWebSearch) console.warn("[chat] web_search 兜底未能联网：", lastUserText.slice(0, 40));
    } catch (e) {
      console.warn("[chat] web_search 兜底异常：", e instanceof Error ? e.message : e);
    }
  }
}

export async function POST(req: NextRequest) {
  let body: { messages?: { role?: string; content?: string }[]; stream?: boolean; sessionId?: string; _noFallback?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  // 仅本地(非 Vercel)测试用：关掉代码兜底测"裸提示词"表现。生产上 VERCEL==="1" 恒忽略。
  const noFallback = process.env.VERCEL !== "1" && body._noFallback === true;
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
      }, undefined, compressed, noFallback);
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
        await runAgent(msgs, uid, emit, req.signal, compressed, noFallback);
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
