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

// 最终喂给模型 / 出来源卡的条数上限。搜回来常混入大量无关垃圾，宁缺毋滥取 6 条（清洗 + 去垃圾 + 按与问题的相关性
// 重排后取前 6）。API 默认返回 10 条、按相关性排序、freshness 参数实测无效，靠注入的当前日期让模型自己挑最新。
const MAX_HITS = 6;

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
  // 清洗 + 去重：① 片段常夹带 <p>/<img …> 等 HTML 标签与 &实体;(实测天气类尤其脏)，会污染喂给模型的素材——剥成纯文本；
  // ② 上游偶发返回完全重复的条目（实测「江西最新天气」连出两条），按 链接/标题 去重，避免重复占满 8 个名额、也避免重复来源卡。
  // ① 清洗 + 去重 + 去垃圾：搜回来常混入空片段、未渲染的动态占位模板页、夹带 HTML 的脏数据，全塞给模型既污染作答又出一堆无用来源卡。
  const seen = new Set<string>();
  const cleaned: WebHit[] = [];
  for (const it of organic) {
    const title = cutSafe(String(it.title ?? ""), 80);
    const link = String(it.link ?? "");
    const key = link || title;
    if (!key || seen.has(key)) continue;
    const snippet = cutSafe(
      // <\/?[a-z!][^>]*>? 同时剥「完整标签」和「被截断成半截的标签」（如片段尾部 <img src='…' 无闭合 >）
      String(it.snippet ?? "").replace(/<\/?[a-z!][^>]*>?/gi, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim(),
      220
    );
    if (/@[a-z_]{2,}@/i.test(title + snippet)) continue; // 未渲染的动态占位模板页（如 @change@ @now@ @date@）
    if (snippet.length < 12 && title.length < 10) continue; // 片段空/极短且标题无信息量 → 抠不出内容
    const textLen = (title + snippet).replace(/[\s\d.,，。!！?？:：;；%¥$()（）【】\/\-—~、]/g, "").length;
    if (textLen < 6) continue; // 几乎只剩数字/符号，无实质文字
    seen.add(key);
    cleaned.push({ title, link, snippet, date: String(it.date ?? "").slice(0, 10) });
  }
  // ② 相关性重排 + 去无关：按与 query 的「2 字片」重叠度打分（如「上海今天天气」→ 上海/今天/天气…），
  //    完全不沾边的条目（搜天气却返回排球赛、企业排行榜之类）整条丢掉，再按相关性高→低取前 MAX_HITS。
  //    只有当「有重叠的结果」太少（<2）时才退回用全部清洗结果，避免把话题冷门的好结果误删到空。
  const qn = query.replace(/[\s,，。、!！?？:：的了吗呢啊]/g, "");
  const shingleSet = new Set<string>();
  for (let i = 0; i < qn.length - 1; i++) shingleSet.add(qn.slice(i, i + 2));
  const shingles = Array.from(shingleSet);
  const scored = cleaned.map((h) => {
    const text = h.title + " " + h.snippet;
    let s = 0;
    for (const sh of shingles) if (text.includes(sh)) s++;
    return { h, s };
  });
  const overlap = scored.filter((x) => x.s > 0);
  const pool = overlap.length >= 2 ? overlap : scored;
  pool.sort((a, b) => b.s - a.s);
  return pool.slice(0, MAX_HITS).map((x) => x.h);
}
