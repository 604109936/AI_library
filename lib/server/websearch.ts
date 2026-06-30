// 联网搜索后端。默认走【火山方舟 Responses API】（豆包同源搜索，质量好、可溯源），
// MiniMax 旧实现完整保留，置 WEBSEARCH_PROVIDER=minimax 可一键切回。
//
// 火山方案：调 /api/v3/responses，开 tools:[{type:"web_search"}]，模型自动联网检索；
//   搜索结果以「引用」形式挂在助手消息的 annotations[]（url_citation）上：{title,url,summary,publish_time,site_name}。
//   我们只取这些引用做来源卡/喂给对话模型，模型那段总结回答用不上 → 关思考 + 限输出，把 token 压到最低
//   （实测：关思考+限400输出后 reasoning_tokens=0、单次约 5k token，引用一条不少）。
//   计费走方舟 token 额度（新用户送 50万）+ 搜索引擎免费额度，单价极低。
// MiniMax 方案：直调 POST /v1/coding_plan/search，计费走 TokenPlan 套餐共享额度。
import "server-only";
import { cutSafe } from "@/lib/server/text";

export interface WebHit {
  title: string;
  link: string;
  snippet: string;
  date: string;
}

// 最终喂给模型 / 出来源卡的条数上限。搜回来常混入大量无关垃圾，宁缺毋滥取 6 条（清洗 + 去垃圾 + 按与问题的相关性
// 重排后取前 6）。靠注入的当前日期让模型自己挑最新。
const MAX_HITS = 6;

// 选后端：显式 WEBSEARCH_PROVIDER=minimax 强制回退；否则配了火山凭证就用火山，都没配再退 MiniMax。
function provider(): "ark" | "minimax" {
  if (process.env.WEBSEARCH_PROVIDER === "minimax") return "minimax";
  if (process.env.WEBSEARCH_PROVIDER === "ark") return "ark";
  if (process.env.ARK_API_KEY && process.env.ARK_SEARCH_ENDPOINT) return "ark";
  return "minimax";
}

export async function searchWeb(query: string): Promise<WebHit[]> {
  const raw = provider() === "ark" ? await fetchArk(query) : await fetchMiniMax(query);
  return refine(raw, query);
}

// 是否可用「流式直答」：仅火山(ark)支持（MiniMax 是纯搜索、不产文）。route 的实时问句分支据此决定走不走直答。
export function webStreamAvailable(): boolean {
  return provider() === "ark";
}

// 流式直答（Option B）：实时问句直接流式吐火山 Responses API 那一遍的回答（边搜边出字），不再丢掉让 Claude 重写。
// onDelta 逐字回调（route 当正文 {t:d} 发出）；返回 {text:完整回答, hits:清洗后的来源(出源卡)}。火山未配/出错则抛，由 route 回落 Claude。
export async function searchWebStream(
  input: string,
  opts: { instructions: string; onDelta: (t: string) => void; signal?: AbortSignal; timeoutMs?: number }
): Promise<{ text: string; hits: WebHit[] }> {
  const key = process.env.ARK_API_KEY;
  const endpoint = process.env.ARK_SEARCH_ENDPOINT;
  if (!key || !endpoint) throw new Error("服务端未配置 ARK_API_KEY / ARK_SEARCH_ENDPOINT");
  const r = await fetch("https://ark.cn-beijing.volces.com/api/v3/responses", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: endpoint,
      input,
      instructions: opts.instructions, // 小涤口吻系统指令
      tools: [{ type: "web_search" }],
      thinking: { type: "disabled" },
      max_output_tokens: 800,
      stream: true,
    }),
    signal: opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 40000)])
      : AbortSignal.timeout(opts.timeoutMs ?? 40000),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    throw new Error(`火山流式直答失败：HTTP ${r.status} ${t.slice(0, 160)}`);
  }
  let text = "";
  const rawHits: WebHit[] = [];
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue; // 跳过 event: 行（type 在 data 的 JSON 里）
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let j: any;
        try { j = JSON.parse(payload); } catch { continue; }
        const ty = j?.type;
        if (ty === "response.output_text.delta" && typeof j.delta === "string") {
          text += j.delta;
          opts.onDelta(j.delta);
        } else if (ty === "response.output_text.annotation.added" && j.annotation?.type === "url_citation") {
          const a = j.annotation;
          rawHits.push({ title: String(a.title ?? ""), link: String(a.url ?? ""), snippet: String(a.summary ?? ""), date: parseCnDate(String(a.publish_time ?? "")) });
        } else if (ty === "response.failed" || ty === "error" || j?.error) {
          throw new Error(`火山流式直答返回错误：${j?.error?.code || j?.code || ty}`);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return { text, hits: refine(rawHits, input) };
}

// ───────────────────────── 火山方舟 Responses API（默认） ─────────────────────────
async function fetchArk(query: string): Promise<WebHit[]> {
  const key = process.env.ARK_API_KEY;
  const endpoint = process.env.ARK_SEARCH_ENDPOINT; // 推理接入点 ID，形如 ep-xxxxxxxx
  if (!key || !endpoint) throw new Error("服务端未配置 ARK_API_KEY / ARK_SEARCH_ENDPOINT");
  const r = await fetch("https://ark.cn-beijing.volces.com/api/v3/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: endpoint,
      input: query,
      tools: [{ type: "web_search" }],
      thinking: { type: "disabled" }, // 关思考：我们只要搜索结果，不要模型的长篇推理，省 token
      max_output_tokens: 512,         // 限输出：模型那段总结用不上，给够带出 annotations 即可
    }),
    signal: AbortSignal.timeout(30000),
  });
  const j: any = await r.json().catch(() => null);
  // 200 + 非 JSON（网关错误页/协议变更）必须抛错而不是当"零结果"：否则基础设施故障会被
  // 模型转述成"网上没查到"，误导用户且无任何日志可排查。
  if (j === null) throw new Error(`火山搜索返回非 JSON（HTTP ${r.status}），疑似网关错误或协议变更`);
  if (!r.ok || j?.error) {
    throw new Error(`火山搜索调用失败：HTTP ${r.status}${j?.error?.code ? ` ${j.error.code}` : ""}`);
  }
  // 搜索结果挂在 output[ type=message ].content[].annotations[ type=url_citation ] 上
  const hits: WebHit[] = [];
  for (const o of Array.isArray(j?.output) ? j.output : []) {
    if (o?.type !== "message") continue;
    for (const c of Array.isArray(o.content) ? o.content : []) {
      for (const a of Array.isArray(c?.annotations) ? c.annotations : []) {
        if (a?.type !== "url_citation") continue;
        hits.push({
          title: String(a.title ?? ""),
          link: String(a.url ?? ""),
          snippet: String(a.summary ?? ""),
          date: parseCnDate(String(a.publish_time ?? "")),
        });
      }
    }
  }
  if (!hits.length) console.warn("[websearch/ark] 未取到 url_citation 引用：", JSON.stringify(j).slice(0, 200));
  return hits;
}

// 「2026年06月30日 05:30:00(CST) 星期二」→「2026-06-30」；解析不出则空串
function parseCnDate(s: string): string {
  const m = s.match(/(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// ───────────────────────── MiniMax（保留，可切回） ─────────────────────────
async function fetchMiniMax(query: string): Promise<WebHit[]> {
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
  if (j === null) throw new Error(`搜索服务返回非 JSON（HTTP ${r.status}），疑似网关错误或协议变更`);
  if (!r.ok || (j?.base_resp && j.base_resp.status_code !== 0)) {
    throw new Error(`搜索服务调用失败：HTTP ${r.status}${j?.base_resp ? ` biz ${j.base_resp.status_code}` : ""}`);
  }
  if (!Array.isArray(j?.organic)) console.warn("[websearch] 响应缺 organic 字段：", JSON.stringify(j).slice(0, 200));
  const organic: any[] = Array.isArray(j?.organic) ? j.organic : [];
  return organic.map((it) => ({
    title: String(it.title ?? ""),
    link: String(it.link ?? ""),
    snippet: String(it.snippet ?? ""),
    date: String(it.date ?? "").slice(0, 10),
  }));
}

// ───────────────────────── 清洗 + 去重 + 去垃圾 + 相关性重排 + 封顶（两后端共用） ─────────────────────────
function refine(raw: WebHit[], query: string): WebHit[] {
  // ① 清洗 + 去重 + 去垃圾：片段常夹带 <p>/<img …> 等 HTML 标签与 &实体;（天气类尤其脏）、空片段、未渲染的动态占位
  //    模板页，全塞给模型既污染作答又出一堆无用来源卡；上游也偶发完全重复的条目 → 按 链接/标题 去重。
  const seen = new Set<string>();
  const cleaned: WebHit[] = [];
  for (const it of raw) {
    const title = cutSafe(String(it.title ?? ""), 80);
    const link = String(it.link ?? "");
    const dedupKey = link || title;
    if (!dedupKey || seen.has(dedupKey)) continue;
    const snippet = cutSafe(
      // <\/?[a-z!][^>]*>? 同时剥「完整标签」和「被截断成半截的标签」（如片段尾部 <img src='…' 无闭合 >）
      String(it.snippet ?? "")
        .replace(/<\/?[a-z!][^>]*>?/gi, " ")
        .replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
      220
    );
    if (/@[a-z_]{2,}@/i.test(title + snippet)) continue; // 未渲染的动态占位模板页（如 @change@ @now@ @date@）
    if (snippet.length < 12 && title.length < 10) continue; // 片段空/极短且标题无信息量 → 抠不出内容
    const textLen = (title + snippet).replace(/[\s\d.,，。!！?？:：;；%¥$()（）【】\/\-—~、]/g, "").length;
    if (textLen < 6) continue; // 几乎只剩数字/符号，无实质文字
    seen.add(dedupKey);
    cleaned.push({ title, link, snippet, date: it.date });
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
