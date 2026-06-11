// T5 前置实测：MiniMax-M3 的输出格式——思考段形态（<think> 还是独立 reasoning 字段）、
// 流式 delta 结构、工具调用时思考如何承载（决定思考链回灌的实现方式）
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const KEY = process.env.MINIMAX_API_KEY;
const BASE = "https://api.minimaxi.com";
const MODEL = process.argv[2] || "MiniMax-M3";

async function call(body) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  return r;
}

/* ① 非流式：看 message 完整结构 */
console.log(`\n========== ① ${MODEL} 非流式 message 结构 ==========`);
{
  const r = await call({ model: MODEL, messages: [{ role: "user", content: "用一句话说明读书的好处" }], max_tokens: 2048 });
  const j = await r.json();
  const msg = j?.choices?.[0]?.message ?? {};
  console.log("message 字段：", Object.keys(msg));
  for (const [k, v] of Object.entries(msg)) {
    console.log(`  ${k}: ${typeof v === "string" ? JSON.stringify(v.slice(0, 200)) : JSON.stringify(v)?.slice(0, 200)}`);
  }
  console.log("usage：", JSON.stringify(j?.usage));
}

/* ② 流式：看 delta 字段（前 12 个非空 delta 原样打出） */
console.log(`\n========== ② ${MODEL} 流式 delta 结构 ==========`);
{
  const r = await call({ model: MODEL, messages: [{ role: "user", content: "一句话推荐《认知觉醒》" }], max_tokens: 2048, stream: true });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", shown = 0, sawKeys = new Set();
  outer: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const p = line.slice(5).trim();
      if (p === "[DONE]") break outer;
      let j; try { j = JSON.parse(p); } catch { continue; }
      const d = j?.choices?.[0]?.delta;
      if (!d) continue;
      Object.keys(d).forEach((k) => sawKeys.add(k));
      if (shown < 12 && Object.keys(d).length) { console.log("delta:", JSON.stringify(d).slice(0, 220)); shown++; }
    }
  }
  console.log("全部 delta 字段并集：", [...sawKeys]);
}

/* ③ 工具调用：思考 + tool_calls 同时出现时的承载方式 */
console.log(`\n========== ③ ${MODEL} 工具调用 message 结构 ==========`);
{
  const tools = [{ type: "function", function: { name: "get_weather", description: "查询指定城市天气", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }];
  const r = await call({ model: MODEL, messages: [{ role: "user", content: "北京今天天气怎么样？" }], max_tokens: 2048, tools });
  const j = await r.json();
  const msg = j?.choices?.[0]?.message ?? {};
  console.log("message 字段：", Object.keys(msg));
  for (const [k, v] of Object.entries(msg)) {
    console.log(`  ${k}: ${typeof v === "string" ? JSON.stringify(v.slice(0, 300)) : JSON.stringify(v)?.slice(0, 300)}`);
  }
  /* ④ 回灌测试：把 assistant 消息原样回灌 + tool 结果，看是否被接受 */
  console.log(`\n========== ④ 原样回灌 assistant(含思考字段)+tool 结果 ==========`);
  const messages = [
    { role: "user", content: "北京今天天气怎么样？" },
    msg,
    { role: "tool", tool_call_id: msg.tool_calls?.[0]?.id ?? "call_0", content: '{"weather":"晴","temp":"28°C"}' },
  ];
  const r2 = await call({ model: MODEL, messages, max_tokens: 1024, tools });
  const j2 = await r2.json();
  if (j2?.base_resp && j2.base_resp.status_code !== 0) console.log("❌ 回灌被拒：", JSON.stringify(j2.base_resp));
  else if (j2?.error) console.log("❌ 回灌被拒：", JSON.stringify(j2.error).slice(0, 300));
  else console.log("✅ 回灌成功，最终回答：", JSON.stringify(j2?.choices?.[0]?.message?.content?.slice(0, 200)));
}
