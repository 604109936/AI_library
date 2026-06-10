// 验证「卡片交错渲染」：推荐/引用卡按工具调用在对话流中的真实位置渲染（不再统一挂气泡末尾）
//   ① 荐书：气泡内出现推荐卡，且卡片之后还有正文段（模型出卡后的收尾话）——交错成立
//   ② 正文不泄漏占位标记 [[recs/[[cites
//   ③ 云端落库的 content 携带标记（历史回显可按位置还原）
//   ④ 答疑：引用卡出现且无标记泄漏
//   ⑤ 测试会话用后即清（demo 是共享体验账号）
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
fs.mkdirSync(".e2e/ui-review", { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

const { data: users } = await admin.auth.admin.listUsers();
const demo = users.users.find((u) => u.email === "demo@ailibrary.app");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// 登录
await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.getByText("登录 / 注册").first().click();
await page.waitForTimeout(600);
await page.getByText("试试体验账号", { exact: false }).click();
await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 });

// 发问并等回答完成（最长 120s）
async function ask(q) {
  await page.fill("textarea", q);
  await page.keyboard.press("Enter");
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const busy = await page.evaluate(() => !!document.querySelector(".animate-bounce") || (document.body.textContent || "").includes("停止生成"));
    if (!busy && i > 3) break;
  }
  await page.waitForTimeout(2000); // 等 persist 上云
}

/* ---------- ① + ② 荐书：卡片交错 ---------- */
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await ask("从馆里挑两本适合我现在读的书，说说为什么");
const rec = await page.evaluate(() => {
  // 最后一个助手气泡（含推荐卡的圆角卡片容器）
  const bubbles = Array.from(document.querySelectorAll(".rounded-tl-sm.bg-snow, .rounded-tl-sm.dark\\:bg-dark-card"));
  const bubble = bubbles[bubbles.length - 1];
  if (!bubble) return { found: false };
  const kids = Array.from(bubble.children);
  const cardIdx = kids.findIndex((el) => (el.textContent || "").includes("为你挑的书"));
  const textAfter = cardIdx >= 0 ? kids.slice(cardIdx + 1).some((el) => el.classList.contains("prose-cn") && (el.textContent || "").trim().length > 4) : false;
  return { found: cardIdx >= 0, cardIdx, total: kids.length, textAfter, leak: (bubble.textContent || "").includes("[[") };
});
ok(rec.found, "推荐卡渲染在气泡内", `子块 ${rec.cardIdx + 1}/${rec.total}`);
ok(rec.found && rec.cardIdx > 0, "推荐卡之前有正文段（先说理由再出卡）");
ok(rec.textAfter, "推荐卡之后还有正文段（出卡后的收尾话）——交错成立");
ok(!rec.leak, "正文无占位标记泄漏");
await page.screenshot({ path: ".e2e/ui-review/卡片交错-荐书.png", fullPage: false });

// ③ 云端 content 带标记
const { data: rows } = await admin.from("chat_sessions").select("id,messages").eq("user_id", demo.id).order("updated_at", { ascending: false }).limit(1);
const lastMsg = rows?.[0]?.messages?.findLast?.((m) => m.role === "assistant") ?? rows?.[0]?.messages?.slice(-1)[0];
ok(!!lastMsg && /\[\[recs:\d+,\d+\]\]/.test(lastMsg.content ?? ""), "落库 content 携带 [[recs]] 占位标记（历史可按位置还原）");
ok(Array.isArray(lastMsg?.recommendations) && lastMsg.recommendations.length > 0, "落库消息携带推荐书数据", `${lastMsg?.recommendations?.length ?? 0} 本`);
const recSessId = rows?.[0]?.id;

/* ---------- ④ 答疑：引用卡 ---------- */
await page.getByLabel("开启新对话").click();
await page.waitForTimeout(800);
await ask("《认知觉醒》第一章讲了什么？");
const cite = await page.evaluate(() => {
  const bubbles = Array.from(document.querySelectorAll(".rounded-tl-sm.bg-snow, .rounded-tl-sm.dark\\:bg-dark-card"));
  const bubble = bubbles[bubbles.length - 1];
  if (!bubble) return { found: false };
  return { found: (bubble.textContent || "").includes("依据原文"), leak: (bubble.textContent || "").includes("[[") };
});
ok(cite.found, "引用卡渲染在气泡内");
ok(!cite.leak, "答疑正文无占位标记泄漏");
await page.screenshot({ path: ".e2e/ui-review/卡片交错-答疑.png", fullPage: false });

// 头像已删：消息流中不应有吉祥物小头像（32px Mascot）
const avatarGone = await page.evaluate(() => !document.querySelector('main .space-y-4 img[alt*="小涤"], main .space-y-4 svg[width="32"]'));
ok(avatarGone, "消息流中已无小头像");

/* ---------- ⑤ 清理测试会话 ---------- */
const { data: after } = await admin.from("chat_sessions").select("id,title").eq("user_id", demo.id).order("updated_at", { ascending: false });
const junk = (after ?? []).filter((r) => r.id === recSessId || String(r.title).includes("认知觉醒") || String(r.title).includes("挑两本"));
for (const j of junk) await admin.from("chat_sessions").delete().eq("user_id", demo.id).eq("id", j.id);
console.log(`⑤ 已清理 ${junk.length} 条测试会话`);

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
