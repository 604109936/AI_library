// 快速探测指定 MiniMax 模型是否对当前 key 开放（用法：node scripts/probe-models.mjs 模型A 模型B…）
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const models = process.argv.slice(2);
for (const model of models) {
  try {
    const r = await fetch("https://api.minimaxi.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + process.env.MINIMAX_API_KEY },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 8 }),
      signal: AbortSignal.timeout(30000),
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    const biz = j?.base_resp && j.base_resp.status_code !== 0 ? `${j.base_resp.status_code} ${j.base_resp.status_msg}` : null;
    const ok = r.ok && !biz && j?.choices;
    console.log(`${ok ? "✅" : "❌"} ${model} → ${ok ? "可用" : `HTTP ${r.status} ${biz ?? t.slice(0, 90)}`}`);
  } catch (e) {
    console.log(`❌ ${model} → ${e.message}`);
  }
}
