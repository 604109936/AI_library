// T10 验收：① 时效性问题正确触发 web_search 并给出带来源回答 ② 馆藏问题不触发搜索
//          ③ UI 级来源卡渲染 + 截图。对话日志留存 evidence/T10
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: backup } = await admin.from("chat_sessions").select("*").eq("user_id", auth.user.id).eq("id", "main").maybeSingle();

const ask = (q) => fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${auth.session.access_token}` },
  body: JSON.stringify({ stream: false, messages: [{ role: "user", content: q }] }),
  signal: AbortSignal.timeout(180000),
}).then((r) => r.json());

const log = [];

/* ① 时效性问题 → 触发搜索 + 来源 */
const q1 = "最近一周 AI 大模型领域有什么新进展？";
const a1 = await ask(q1);
log.push({ q: q1, events: a1.events, content: a1.content });
const webEv = (a1.events ?? []).find((e) => e.t === "web");
ok(!!webEv, "① 时效性问题触发 web_search", JSON.stringify((a1.events ?? []).map((e) => e.t)));
ok(!!webEv && webEv.v.items.length >= 1, "①b 来源条目下发", `${webEv?.v.items.length ?? 0} 条`);
ok(typeof a1.content === "string" && a1.content.length > 80 && !a1.content.includes("<think>"), "①c 带来源回答正常生成", `${a1.content?.length ?? 0} 字`);

/* ② 馆藏问题 → 不触发搜索 */
const q2 = "馆里的《了凡四训》主要讲什么？";
const a2 = await ask(q2);
log.push({ q: q2, events: a2.events, content: a2.content });
const noWeb = !(a2.events ?? []).some((e) => e.t === "web");
ok(noWeb, "② 馆藏问题不触发搜索", JSON.stringify((a2.events ?? []).map((e) => e.t)));

fs.mkdirSync("docs/delivery/evidence/T10", { recursive: true });
fs.writeFileSync("docs/delivery/evidence/T10/对话日志-触发与不触发.json", JSON.stringify(log, null, 2));

/* ③ UI 级：来源卡渲染 */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.getByText("登录 / 注册").first().click();
await page.waitForTimeout(600);
await page.getByText("试试体验账号", { exact: false }).click();
await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 });
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.fill("textarea", "帮我在网上查查最近有什么值得关注的新书出版");
await page.keyboard.press("Enter");
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(1000);
  const busy = await page.evaluate(() => !!document.querySelector(".animate-bounce") || (document.body.textContent || "").includes("停止生成"));
  if (!busy && i > 3) break;
}
await page.waitForTimeout(1500);
const uiWeb = await page.evaluate(() => {
  // 用 innerText（不含 <script> 内容）：textContent 会把 Next.js RSC 序列化数据算进来（含 [[ 假阳性）
  const t = document.querySelector("main")?.innerText ?? "";
  return { card: /来源 \d+ 处/.test(t), leak: t.includes("[["), links: document.querySelectorAll('a[target="_blank"][rel*="noopener"]').length };
});
ok(uiWeb.card, "③ 来源卡渲染在气泡内", `外链 ${uiWeb.links} 个`);
ok(!uiWeb.leak, "③b 无标记泄漏");
fs.mkdirSync(".e2e/ui-review", { recursive: true });
await page.screenshot({ path: ".e2e/ui-review/T10-联网来源卡.png", fullPage: false });
await browser.close();

// 还原 demo main
if (backup) await admin.from("chat_sessions").upsert(backup, { onConflict: "user_id,id" });
else await admin.from("chat_sessions").delete().eq("user_id", auth.user.id).eq("id", "main");
console.log("demo main 已恢复原样");
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
