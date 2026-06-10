// 探测 MiniMax TokenPlan 密钥可用的「端点 × 模型」组合（T2.1 前置）
// sk-cp- 前缀是订阅计划密钥，可能只对部分端点放行，逐一探明再写云函数。
import fs from "node:fs";
try {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const KEY = process.env.MINIMAX_API_KEY;
if (!KEY) { console.log("❌ .env.local 缺 MINIMAX_API_KEY"); process.exit(1); }

const tries = [];
for (const base of ["https://api.minimaxi.com", "https://api.minimax.io"]) {
  for (const model of ["MiniMax-M2", "MiniMax-Text-01"]) {
    tries.push({
      name: `${base} chatcompletion_v2 ${model}`,
      url: `${base}/v1/text/chatcompletion_v2`,
      body: { model, messages: [{ role: "user", content: "只回两个字：连通" }], max_tokens: 16 },
      pick: (j) => j?.choices?.[0]?.message?.content,
    });
    tries.push({
      name: `${base} chat/completions ${model}`,
      url: `${base}/v1/chat/completions`,
      body: { model, messages: [{ role: "user", content: "只回两个字：连通" }], max_tokens: 16 },
      pick: (j) => j?.choices?.[0]?.message?.content,
    });
  }
  tries.push({
    name: `${base} anthropic/v1/messages MiniMax-M2`,
    url: `${base}/anthropic/v1/messages`,
    anthropic: true,
    body: { model: "MiniMax-M2", max_tokens: 16, messages: [{ role: "user", content: "只回两个字：连通" }] },
    pick: (j) => j?.content?.map?.((c) => c.text).join(""),
  });
}

for (const t of tries) {
  try {
    const headers = t.anthropic
      ? { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" }
      : { "content-type": "application/json", authorization: `Bearer ${KEY}` };
    const r = await fetch(t.url, { method: "POST", headers, body: JSON.stringify(t.body), signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    const reply = t.pick(j);
    // MiniMax 经典端点 HTTP 200 也可能业务报错（base_resp.status_code != 0）
    const bizErr = j?.base_resp && j.base_resp.status_code !== 0 ? `biz:${j.base_resp.status_code} ${j.base_resp.status_msg}` : null;
    if (r.ok && reply && !bizErr) console.log(`✅ ${t.name} → "${String(reply).slice(0, 30)}"`);
    else console.log(`❌ ${t.name} → HTTP ${r.status} ${bizErr ?? String(text).slice(0, 140).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`❌ ${t.name} → ${e.message}`);
  }
}
