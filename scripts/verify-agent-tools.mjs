// 验证 T2.3 工具 + T2.4 流式：
// ① 荐书 → 应触发 recs 卡片事件（真实 book_id）
// ② 章节答疑 → 应触发 cites 引用卡事件且回答有据
// ③ 流式 → 文本逐块到达（多个 d 事件）、首字延迟、无 <think> 泄漏
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";

async function askJson(q) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: q }], stream: false }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j;
}

// ① 荐书 → recs
const a = await askJson("我最近有点迷茫，给我推荐两本馆里的书，说说为什么");
const recs = (a.events ?? []).find((e) => e.t === "recs");
console.log(`① 荐书：recs 卡片事件 ${recs ? `✅ [${recs.v.join(", ")}]` : "❌ 未触发"}；正文 ${a.content.length} 字`);
console.log("   正文节选:", a.content.replace(/\n/g, " | ").slice(0, 180));

// ② 章节答疑 → cites
const b = await askJson("《了凡四训》第2章主要讲了什么？请注明出处");
const cites = (b.events ?? []).find((e) => e.t === "cites");
console.log(`② 答疑：cites 引用卡事件 ${cites ? `✅ ${JSON.stringify(cites.v)}` : "❌ 未触发"}；正文 ${b.content.length} 字`);
console.log("   正文节选:", b.content.replace(/\n/g, " | ").slice(0, 180));

// ③ 流式
const t0 = Date.now();
const r = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "用三句话介绍《清醒地活》" }] }),
  signal: AbortSignal.timeout(180000),
});
const reader = r.body.getReader();
const dec = new TextDecoder();
let buf = "", dCount = 0, firstAt = 0, text = "", sawEnd = false;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    const ev = JSON.parse(line);
    if (ev.t === "d") { dCount++; text += ev.v; if (!firstAt) firstAt = Date.now() - t0; }
    if (ev.t === "end") sawEnd = true;
  }
}
console.log(`③ 流式：增量 ${dCount} 块（${dCount > 5 ? "✅ 逐块" : "❌ 太少"}）｜首字 ${(firstAt / 1000).toFixed(1)}s｜总 ${((Date.now() - t0) / 1000).toFixed(1)}s｜end ${sawEnd ? "✅" : "❌"}｜<think>泄漏 ${text.includes("<think>") ? "❌ 有" : "✅ 无"}`);
console.log("   正文节选:", text.replace(/\n/g, " | ").slice(0, 160));
