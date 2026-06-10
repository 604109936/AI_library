// MiniMax 服务端客户端（仅云函数使用，密钥绝不进前端）。
// 探测结论（scripts/test-minimax.mjs，2026-06-11）：TokenPlan 订阅 key 只认国内域名 api.minimaxi.com；
// OpenAI 兼容端点 /v1/chat/completions 可用；可用模型 MiniMax-M2（带 <think> 思考段）/ MiniMax-Text-01（干净、4M 上下文）。
import "server-only";

const BASE = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com";
// 默认 Text-01：响应快、输出干净、超长上下文适合塞整馆书单；要换 M2 只需在 .env.local 设 MINIMAX_MODEL=MiniMax-M2
const MODEL = process.env.MINIMAX_MODEL || "MiniMax-Text-01";

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

// M 系推理模型会把思考过程包在 <think>…</think> 里输出，展示前剥掉
export function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^<think>[\s\S]*/g, "").trim();
}

// 流式版思考过滤器：跨 chunk 也能正确剥 <think>…</think>（标签可能被块边界拆开）
export function makeThinkFilter() {
  let pend = "";
  let inThink = false;
  return (chunk: string, flush = false): string => {
    pend += chunk;
    let out = "";
    for (;;) {
      if (inThink) {
        const i = pend.indexOf("</think>");
        if (i === -1) { pend = pend.slice(-9); break; } // 思考内容直接丢弃，只留尾巴防拆标签
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
    if (flush && !inThink) { out += pend; pend = ""; }
    return out;
  };
}

// 流式对话（SSE）。产出两类事件：文本增量（已剥思考）/ 完整组装好的工具调用组。
// 工具调用增量按 OpenAI 规范以 index 聚合（id/name 先到，arguments 分片续传）。
export async function* streamChat(
  messages: MMMessage[],
  opts?: { maxTokens?: number; temperature?: number; tools?: MMTool[]; signal?: AbortSignal }
): AsyncGenerator<{ type: "delta"; text: string } | { type: "tool_calls"; calls: MMToolCall[] }> {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("服务端未配置 MINIMAX_API_KEY");
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0.8,
      ...(opts?.tools?.length ? { tools: opts.tools } : {}),
    }),
    signal: opts?.signal ?? AbortSignal.timeout(120000),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    throw new Error(`MiniMax 流式调用失败：HTTP ${r.status} ${t.slice(0, 160)}`);
  }
  const filter = makeThinkFilter();
  const calls: { id: string; name: string; args: string }[] = [];
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
          const text = filter(d.content);
          if (text) yield { type: "delta", text };
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
  if (tail) yield { type: "delta", text: tail };
  const valid = calls.filter((c) => c.name);
  if (valid.length) {
    yield { type: "tool_calls", calls: valid.map((c, i) => ({ id: c.id || `call_${i}`, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } })) };
  }
}

export async function chatOnce(messages: MMMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("服务端未配置 MINIMAX_API_KEY");
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: opts?.maxTokens ?? 2048,
      temperature: opts?.temperature ?? 0.8,
    }),
    signal: AbortSignal.timeout(60000),
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
