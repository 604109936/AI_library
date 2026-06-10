// 诊断：MiniMax M3 流式 + tools 时，tool_calls 在 SSE 里的真实格式（原样打印）
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const r = await fetch("https://api.minimaxi.com/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MINIMAX_API_KEY}` },
  body: JSON.stringify({
    model: process.env.MINIMAX_MODEL || "MiniMax-M3",
    stream: true,
    max_tokens: 1024,
    messages: [
      { role: "system", content: "你是图书馆助手。馆藏：[bk1]《认知觉醒》、[bk2]《了凡四训》。当你要推荐书时，必须调用 recommend_books 工具展示卡片。" },
      { role: "user", content: "推荐一本书给我" },
    ],
    tools: [{
      type: "function",
      function: {
        name: "recommend_books",
        description: "展示推荐书目卡片",
        parameters: { type: "object", properties: { book_ids: { type: "array", items: { type: "string" } } }, required: ["book_ids"] },
      },
    }],
  }),
  signal: AbortSignal.timeout(120000),
});
console.log("HTTP", r.status);
const reader = r.body.getReader();
const dec = new TextDecoder();
let buf = "", n = 0;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line.startsWith("data:")) continue;
    const p = line.slice(5).trim();
    n++;
    if (p === "[DONE]") { console.log(`[${n}] [DONE]`); continue; }
    let j; try { j = JSON.parse(p); } catch { console.log(`[${n}] 非JSON:`, p.slice(0, 100)); continue; }
    const ch = j?.choices?.[0] ?? {};
    const piece = {
      finish: ch.finish_reason ?? null,
      delta_keys: ch.delta ? Object.keys(ch.delta) : null,
      content_len: typeof ch.delta?.content === "string" ? ch.delta.content.length : null,
      tool_calls: ch.delta?.tool_calls ?? ch.message?.tool_calls ?? null,
      msg_keys: ch.message ? Object.keys(ch.message) : null,
    };
    console.log(`[${n}]`, JSON.stringify(piece).slice(0, 300));
  }
}
