// 批量生成书籍「一句话简介」short_intro（书单方案A：系统提示只带一句话/本，完整概要由 get_book_briefs 按需取）。
// 幂等：只处理 short_intro 为空的书；已有值不重写。生成失败的书保持为空（运行时自动回退「截概要前40字」，不阻塞）。
//   干跑预览（默认，不写库）：node --env-file=.env.local scripts/gen-short-intros.mjs
//   真正写库：              node --env-file=.env.local scripts/gen-short-intros.mjs --commit
// 依赖 env：NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ARK_API_KEY / CHAT_MODEL（火山豆包接入点）
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const MAX_LEN = 42; // 简介硬上限（目标 ≤30 字，留少量余量；超限判为不合格）
const CONCURRENCY = 3;

const { NEXT_PUBLIC_SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SB_KEY, ARK_API_KEY, CHAT_MODEL } = process.env;
for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SB_KEY, ARK_API_KEY, CHAT_MODEL })) {
  if (!v) { console.error(`❌ 缺少环境变量 ${k}（用 node --env-file=.env.local 运行）`); process.exit(1); }
}
if (!/^ep-/.test(CHAT_MODEL)) { console.error(`❌ CHAT_MODEL=${CHAT_MODEL} 不是火山接入点（ep-*）——本脚本只走火山豆包`); process.exit(1); }
const db = createClient(SB_URL, SB_KEY);

// 生成一句话简介：输入全书概要，产出 ≤30 字钩子句。校验不过重试一次（更严指令），仍不过返回 null（跳过、运行时兜底）。
async function genIntro(title, digest, strict = false) {
  const sys = `你为图书写一句话简介（书单场景，读者扫一眼决定要不要了解）。要求：只输出简介本身；${strict ? "不超过28个字；" : "尽量20~30个字；"}不带书名不带作者；不用引号不用句号结尾；说清这本书解决什么问题或最抓人的看点；不空洞（禁「一本好书」「值得一读」这类废话）。`;
  const r = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${ARK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [{ role: "system", content: sys }, { role: "user", content: `《${title}》全书概要：\n${digest}` }],
      max_tokens: 120, temperature: 0.4, thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.choices?.[0]?.message?.content) throw new Error(`火山调用失败 HTTP ${r.status} ${JSON.stringify(j?.error ?? "").slice(0, 120)}`);
  // 清洗：去引号/书名号/markdown/换行/句尾标点
  let s = String(j.choices[0].message.content).trim()
    .replace(/^["'“”‘’「」《》\s]+|["'“”‘’「」《》\s]+$/g, "")
    .replace(/[\r\n]+/g, " ").replace(/[*#>`]/g, "").replace(/[。.！!]+$/, "").trim();
  if (!s || s.length > MAX_LEN || s.includes(title)) return null; // 不合格
  return s;
}

const { data: books, error } = await db
  .from("books")
  .select("id,title,ai_digest,short_intro")
  .or("short_intro.is.null,short_intro.eq.")
  .order("id");
if (error) { console.error("❌ 读书表失败：", error.message); process.exit(1); }
const todo = (books ?? []).filter((b) => (b.ai_digest ?? "").trim().length >= 20);
const skipped = (books ?? []).length - todo.length;
console.log(`待生成 ${todo.length} 本（另 ${skipped} 本概要缺失/过短，跳过）｜模式：${COMMIT ? "写库" : "干跑预览（加 --commit 才写库）"}\n`);

let ok = 0, bad = 0;
// 简单并发池
const queue = [...todo];
async function worker() {
  for (;;) {
    const b = queue.shift();
    if (!b) return;
    try {
      let intro = await genIntro(b.title, b.ai_digest.trim());
      if (intro === null) intro = await genIntro(b.title, b.ai_digest.trim(), true); // 严格模式重试一次
      if (intro === null) { bad++; console.log(`⚠️ 《${b.title}》两次生成都不合格，保持为空（运行时回退截概要）`); continue; }
      if (COMMIT) {
        const { error: e } = await db.from("books").update({ short_intro: intro }).eq("id", b.id);
        if (e) { bad++; console.log(`❌ 《${b.title}》写库失败：${e.message}`); continue; }
      }
      ok++;
      console.log(`✅ [${b.id}]《${b.title}》→ ${intro}（${intro.length}字）`);
    } catch (e) {
      bad++;
      console.log(`❌ 《${b.title}》生成异常：${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\n完成：成功 ${ok} / 失败或跳过 ${bad}${COMMIT ? "（已写库）" : "（干跑，未写库）"}`);
