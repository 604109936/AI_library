// T10 前置实测：绕过 Python MCP，直调底层 HTTP（POST /v1/coding_plan/search）验证连通
// 来源：minimax_mcp 包源码 server.py:88 api_client.post("/v1/coding_plan/search", json={"q": query})
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const q = process.argv[2] || "2026年6月 AI 大模型 最新进展";
const r = await fetch("https://api.minimaxi.com/v1/coding_plan/search", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
    "MM-API-Source": "Minimax-MCP",
  },
  body: JSON.stringify({ q }),
  signal: AbortSignal.timeout(30000),
});
const j = await r.json();
console.log("HTTP", r.status, "base_resp:", JSON.stringify(j?.base_resp));
const organic = j?.organic ?? [];
console.log(`organic 共 ${organic.length} 条，前 3 条：`);
for (const it of organic.slice(0, 3)) console.log(`- [${it.date ?? "无日期"}] ${it.title}\n  ${it.link}\n  ${String(it.snippet ?? "").slice(0, 100)}`);
console.log("related_searches:", JSON.stringify((j?.related_searches ?? []).slice(0, 3)));
