// T10 联网搜索（MiniMax TokenPlan 订阅）：直调底层 HTTP 端点 POST /v1/coding_plan/search。
// 来源：官方 MCP 包（minimax_mcp 0.0.4）源码扒出的协议——Vercel 无 Python 运行时跑不了 MCP 子进程，
// TS 直调等价且零额外依赖（实测连通见 docs/delivery/evidence/T10/websearch-http-probe.md）。
// 计费走 TokenPlan 套餐共享额度，不另扣现金。
import "server-only";
import { cutSafe } from "@/lib/server/text";

export interface WebHit {
  title: string;
  link: string;
  snippet: string;
  date: string;
}

// 取前 8 条（原 5 条会把排名靠后但更新的好结果截掉——实测"最新AI模型"里 Claude 4.8 排第 7）。
// API 默认返回 10 条且按相关性排序、freshness 参数实测无效；保留相关性序、靠注入的当前日期让模型自己挑最新。
const MAX_HITS = 8;

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
  // 200 + 非 JSON（网关错误页/协议变更）必须抛错而不是当"零结果"：否则基础设施故障会被
  // 模型转述成"网上没查到"，误导用户且无任何日志可排查
  if (j === null) throw new Error(`搜索服务返回非 JSON（HTTP ${r.status}），疑似网关错误或协议变更`);
  if (!r.ok || (j?.base_resp && j.base_resp.status_code !== 0)) {
    throw new Error(`搜索服务调用失败：HTTP ${r.status}${j?.base_resp ? ` biz ${j.base_resp.status_code}` : ""}`);
  }
  if (!Array.isArray(j?.organic)) console.warn("[websearch] 响应缺 organic 字段：", JSON.stringify(j).slice(0, 200));
  const organic: any[] = Array.isArray(j?.organic) ? j.organic : [];
  return organic.slice(0, MAX_HITS).map((it) => ({
    title: cutSafe(String(it.title ?? ""), 80),
    link: String(it.link ?? ""),
    snippet: cutSafe(String(it.snippet ?? "").replace(/\s+/g, " ").trim(), 200),
    date: String(it.date ?? "").slice(0, 10),
  }));
}
