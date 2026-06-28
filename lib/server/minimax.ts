// MiniMax 服务端客户端（仅云函数使用，密钥绝不进前端）。
// 探测结论（scripts/probe-m3-format.mjs，2026-06-11）：TokenPlan 订阅 key 只认国内域名 api.minimaxi.com；
// OpenAI 兼容端点 /v1/chat/completions 可用；MiniMax-M3 思考段为 content 内联 <think>…</think>（无独立字段），
// 工具循环回灌历史时 assistant content 必须完整保留 <think>（interleaved thinking，官方要求，否则每轮"失忆"）。
import "server-only";

const BASE = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com";
// 默认 M3：MiniMax 最新旗舰，agentic 多步规划强（任务书 T5 全量切换，2026-06-11 实测 ID 可用）
const MODEL = process.env.MINIMAX_MODEL || "MiniMax-M3";

export interface MMToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface MMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: MMToolCall[]; // assistant 发起的工具调用
  tool_call_id?: string; // tool 结果对应的调用 id
}
export interface MMTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// M 系推理模型会把思考过程包在 <think>…</think> 里输出，展示前剥掉。
// (<\/think>|$) 兼容"输出被 max_tokens 截断在思考段内"的未闭合形态（任意位置开始都剥到结尾）
function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
}

// 流式版思考过滤器：跨 chunk 也能正确切分 <think>…</think>（标签可能被块边界拆开）。
// 两路输出：out=面向用户的正文增量（剥净思考）；think=思考文本增量（T8 包装成过程提示，绝不直出给用户）
function makeThinkFilter() {
  let pend = "";
  let inThink = false;
  return (chunk: string, flush = false): { out: string; think: string } => {
    pend += chunk;
    let out = "";
    let think = "";
    for (;;) {
      if (inThink) {
        const i = pend.indexOf("</think>");
        if (i === -1) {
          // 思考内容产出到 think 路，只留尾巴防拆标签
          const keep = Math.min(9, pend.length);
          think += pend.slice(0, pend.length - keep);
          pend = pend.slice(pend.length - keep);
          break;
        }
        think += pend.slice(0, i);
        pend = pend.slice(i + 8);
        inThink = false;
      } else {
        const i = pend.indexOf("<think>");
        if (i !== -1) { out += pend.slice(0, i); pend = pend.slice(i + 7); inThink = true; continue; }
        // 尾部若可能是被拆开的标签前缀则先扣住不发
        let hold = 0;
        for (let k = Math.min(8, pend.length); k > 0; k--) {
          const tail = pend.slice(-k);
          if ("<think>".startsWith(tail) || "</think>".startsWith(tail)) { hold = k; break; }
        }
        out += pend.slice(0, pend.length - hold);
        pend = pend.slice(pend.length - hold);
        break;
      }
    }
    if (flush) {
      if (inThink) think += pend; // 未闭合的思考段（max_tokens 烧尽等）整体归思考，不漏给用户
      else out += pend;
      pend = "";
    }
    return { out, think };
  };
}

// 流式对话（SSE）。产出三类事件：
//   delta=用户可见正文增量（已剥思考）；think=思考文本增量（供过程提示包装，不直出）；
//   tool_calls=完整组装好的工具调用组 + rawContent（本轮原始 content 含 <think>，回灌历史必须用它——
//   M 系 interleaved thinking 官方要求完整保留思考，否则每轮工具调用都"失忆"降智）。
// 工具调用增量按 OpenAI 规范以 index 聚合（id/name 先到，arguments 分片续传）。
export async function* streamChat(
  messages: MMMessage[],
  opts?: {
    maxTokens?: number; temperature?: number; tools?: MMTool[]; signal?: AbortSignal; timeoutMs?: number; model?: string;
    // 强制工具选择（OpenAI 兼容）：指定 {type,function:{name}} 可逼模型本轮必调某工具——
    // 用于读者明确要求联网时根治"只口头答应不真调用"。缺省=auto（模型自行决定）。
    toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  }
): AsyncGenerator<
  | { type: "delta"; text: string }
  | { type: "think"; text: string }
  | { type: "tool_calls"; calls: MMToolCall[]; rawContent: string }
> {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("服务端未配置 MINIMAX_API_KEY");
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts?.model ?? MODEL,
      messages,
      stream: true,
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0.8,
      ...(opts?.tools?.length ? { tools: opts.tools } : {}),
      ...(opts?.toolChoice ? { tool_choice: opts.toolChoice } : {}),
    }),
    // 客户端断开与超时双重保护：只传 req.signal 会丢超时，上游挂起时用户会白等到平台杀进程。
    // timeoutMs 由调用方按整请求剩余预算传入（工具循环多轮共享 120s，每轮各吃满会被平台硬杀产生无 end 截断流）
    signal: opts?.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts?.timeoutMs ?? 120000)])
      : AbortSignal.timeout(opts?.timeoutMs ?? 120000),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    throw new Error(`MiniMax 流式调用失败：HTTP ${r.status} ${t.slice(0, 160)}`);
  }
  const filter = makeThinkFilter();
  const calls: { id: string; name: string; args: string }[] = [];
  let raw = ""; // 本轮完整原始 content（含 <think>）：tool_calls 事件随附，供回灌
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") { finished = true; break; }
        let j: any;
        try { j = JSON.parse(payload); } catch { continue; }
        if (j?.base_resp && j.base_resp.status_code !== 0) throw new Error(`MiniMax 流式业务错误：${j.base_resp.status_code} ${j.base_resp.status_msg}`);
        const ch = j?.choices?.[0];
        if (!ch) continue;
        const d = ch.delta ?? {};
        if (typeof d.content === "string" && d.content) {
          raw += d.content;
          const { out, think } = filter(d.content);
          if (out) yield { type: "delta", text: out };
          if (think) yield { type: "think", text: think };
        }
        if (Array.isArray(d.tool_calls)) {
          for (const tc of d.tool_calls) {
            const idx = tc.index ?? 0;
            calls[idx] ??= { id: "", name: "", args: "" };
            if (tc.id) calls[idx].id = tc.id;
            if (tc.function?.name) calls[idx].name = tc.function.name;
            if (tc.function?.arguments) calls[idx].args += tc.function.arguments;
          }
        }
      }
      if (finished) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const tail = filter("", true);
  if (tail.out) yield { type: "delta", text: tail.out };
  if (tail.think) yield { type: "think", text: tail.think };
  const valid = calls.filter((c) => c.name);
  if (valid.length) {
    yield {
      type: "tool_calls",
      calls: valid.map((c, i) => ({ id: c.id || `call_${i}`, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } })),
      rawContent: raw,
    };
  }
}

export async function chatOnce(messages: MMMessage[], opts?: { maxTokens?: number; temperature?: number; model?: string; timeoutMs?: number }): Promise<string> {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("服务端未配置 MINIMAX_API_KEY");
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts?.model ?? MODEL,
      messages,
      max_tokens: opts?.maxTokens ?? 2048,
      temperature: opts?.temperature ?? 0.8,
    }),
    // 默认 60s 是给长回答留的；时间预算紧的调用方（如 feed 排序）必须传更紧的 timeoutMs
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 60000),
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch {}
  // MiniMax 部分错误以 HTTP 200 + base_resp 业务码返回，必须双重检查
  const biz = j?.base_resp;
  if (!r.ok || (biz && biz.status_code !== 0)) {
    throw new Error(`MiniMax 调用失败：HTTP ${r.status}${biz ? ` biz ${biz.status_code} ${biz.status_msg}` : ""}`);
  }
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new Error("MiniMax 返回为空");
  return stripThink(content);
}
