// T10 联网搜索（MiniMax TokenPlan 订阅）：直调底层 HTTP 端点 POST /v1/coding_plan/search。
// 来源：官方 MCP 包（minimax_mcp 0.0.4）源码扒出的协议——Vercel 无 Python 运行时跑不了 MCP 子进程，
// TS 直调等价且零额外依赖（实测连通见 docs/delivery/evidence/T10/websearch-http-probe.md）。
// 计费走 TokenPlan 套餐共享额度，不另扣现金。
import "server-only";

export interface WebHit {
  title: string;
  link: string;
  snippet: string;
  date: string;
}

const MAX_HITS = 5; // 截前 5 条控上下文（单条 snippet 再截 200 字，合计约 1.2K 字不撑爆窗口）

export async function searchWeb(query: string): Promise<WebHit[]> {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("服务端未配置 MINIMAX_API_KEY");
  const r = await fetch("https://api.minimaxi.com/v1/coding_plan/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "MM-API-Source": "Minimax-MCP",
    },
    body: JSON.stringify({ q: query }),
    signal: AbortSignal.timeout(20000),
  });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || (j?.base_resp && j.base_resp.status_code !== 0)) {
    throw new Error(`搜索服务调用失败：HTTP ${r.status}${j?.base_resp ? ` biz ${j.base_resp.status_code}` : ""}`);
  }
  const organic: any[] = Array.isArray(j?.organic) ? j.organic : [];
  return organic.slice(0, MAX_HITS).map((it) => ({
    title: String(it.title ?? "").slice(0, 80),
    link: String(it.link ?? ""),
    snippet: String(it.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    date: String(it.date ?? "").slice(0, 10),
  }));
}
