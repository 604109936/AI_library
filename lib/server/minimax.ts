// MiniMax 服务端客户端（仅云函数使用，密钥绝不进前端）。
// 探测结论（scripts/test-minimax.mjs，2026-06-11）：TokenPlan 订阅 key 只认国内域名 api.minimaxi.com；
// OpenAI 兼容端点 /v1/chat/completions 可用；可用模型 MiniMax-M2（带 <think> 思考段）/ MiniMax-Text-01（干净、4M 上下文）。
import "server-only";

const BASE = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com";
// 默认 Text-01：响应快、输出干净、超长上下文适合塞整馆书单；要换 M2 只需在 .env.local 设 MINIMAX_MODEL=MiniMax-M2
const MODEL = process.env.MINIMAX_MODEL || "MiniMax-Text-01";

export interface MMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// M2 等推理模型会把思考过程包在 <think>…</think> 里输出，展示前剥掉
export function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^<think>[\s\S]*/g, "").trim();
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
