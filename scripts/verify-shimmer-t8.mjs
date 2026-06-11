// T8 验收：① 流式事件日志——status 过程提示无任何业务/技术细节泄漏（工具名/book_id/英文标识符）
//          ② 无头浏览器截图 shimmer 动效（思考态 + 工具态）
//          ③ 代码层核对动效仅用可合成属性（transform）
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

/* ① 流式抓事件：完整日志含思考包装提示 */
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: backup } = await admin.from("chat_sessions").select("*").eq("user_id", auth.user.id).eq("id", "main").maybeSingle();

const resp = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${auth.session.access_token}` },
  body: JSON.stringify({ messages: [{ role: "user", content: "《被讨厌的勇气》第二章讲了什么？引用原文" }] }),
  signal: AbortSignal.timeout(180000),
});
const events = [];
const reader = resp.body.getReader();
const dec = new TextDecoder();
let buf = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) try { events.push(JSON.parse(line)); } catch {}
  }
}
const statuses = events.filter((e) => e.t === "status").map((e) => e.v);
console.log("status 提示序列：", JSON.stringify(statuses, null, 2));
ok(statuses.length >= 1, "① 有过程提示下发", `${statuses.length} 条`);
// 泄漏核对：禁止 工具名/内部字段/英文标识符/报错样式/省略号
const LEAK = /recommend_books|read_book_toc|read_chapter|cite_chapters|web_search|book_id|chapter_no|tool|error|Error|http|HTTP|\{|\}|_|…|\.\.\./;
const leaky = statuses.filter((s) => LEAK.test(s));
ok(leaky.length === 0, "② 提示文案零业务/技术细节泄漏、零省略号", leaky.join("｜") || "全部干净");
const tooLong = statuses.filter((s) => s.length > 20);
ok(tooLong.length === 0, "③ 提示均 ≤20 字", tooLong.join("｜") || "");
const txt = events.filter((e) => e.t === "d").map((e) => e.v).join("");
ok(!txt.includes("<think>") && statuses.every((s) => !s.includes("<think>")), "④ 全链路无思考原文泄漏");
fs.mkdirSync("docs/delivery/evidence/T8", { recursive: true });
fs.writeFileSync("docs/delivery/evidence/T8/事件日志-含思考包装.json", JSON.stringify(events.filter((e) => e.t !== "d"), null, 2) + "\n// 正文（d 事件拼接）：\n// " + txt.slice(0, 300).replace(/\n/g, " "));

/* ② 截图 shimmer：进入聊天页发问，思考期截两帧（验证扫光在动） */
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
await page.fill("textarea", "推荐一本讲心学的书");
await page.keyboard.press("Enter");
await page.waitForTimeout(2500); // 思考期
fs.mkdirSync(".e2e/ui-review", { recursive: true });
await page.screenshot({ path: ".e2e/ui-review/T8-shimmer-思考态-帧1.png" });
const hasShimmer = await page.evaluate(() => !!document.querySelector(".shimmer-win"));
ok(hasShimmer, "⑤ 思考态渲染 shimmer 组件");
const noBounce = await page.evaluate(() => !document.querySelector(".animate-bounce"));
ok(noBounce, "⑥ 跳点动效已移除");
await page.waitForTimeout(1300); // 半个动画周期后第二帧（扫光位置应不同）
await page.screenshot({ path: ".e2e/ui-review/T8-shimmer-思考态-帧2.png" });
// 等回答完成再退出（防半途 abort 留中间态）
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000);
  const busy = await page.evaluate(() => (document.body.textContent || "").includes("停止生成"));
  if (!busy && i > 3) break;
}
await browser.close();

/* ③ 代码层核对：shimmer 动画仅 transform */
const css = fs.readFileSync("app/globals.css", "utf8");
const seg = css.slice(css.indexOf(".shimmer-win"), css.indexOf("/* 骨架屏"));
// 只核对 @keyframes 块内逐帧动画的属性（规则体里的 animation/will-change 是声明不是动画属性）
const kfBlocks = [...seg.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
const keyframeProps = kfBlocks.flatMap((b) => [...b.matchAll(/([a-z-]+):/g)].map((m) => m[1]));
const onlyComposite = keyframeProps.length > 0 && keyframeProps.every((p) => p === "transform" || p === "opacity");
ok(onlyComposite, "⑦ 关键帧仅用可合成属性", `keyframes 属性=${[...new Set(keyframeProps)].join(",")}`);

// 还原 demo main
if (backup) await admin.from("chat_sessions").upsert(backup, { onConflict: "user_id,id" });
console.log("demo main 已恢复原样");
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
