// 验证 T2.5 对话云同步：登录态对话 → chat_sessions 落库 → 历史页云端回显
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const REF = URL_.match(/https:\/\/([^.]+)\./)[1];

// ① 拿 demo 登录会话 + 落库前基线
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
if (error) { console.log("❌ demo 登录失败:", error.message); process.exit(1); }
const uid = auth.user.id;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const before = (await admin.from("chat_sessions").select("id").eq("user_id", uid)).data?.length ?? 0;

// ② 浏览器走真实 UI 登录（顺带验证登录时云端会话加载）→ 智学发问 → 等回答完成
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.getByText("登录 / 注册").first().click();
await page.waitForTimeout(600);
await page.getByText("试试体验账号", { exact: false }).click(); // C1 后一键直接登录（自动提交）
// 等登录真正完成（「我的」页用户区出现「编辑资料」）
await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 }).catch(() => {});
const logged = await page.evaluate(() => (document.body.textContent || "").includes("编辑资料"));
console.log(`①.5 UI 登录：${logged ? "✅" : "❌ 未见登录态"}`);
if (!logged) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const Q = "用一句话介绍馆里的《格调》";
await page.fill("textarea", Q);
await page.keyboard.press("Enter");
let txt = "";
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => {
    const els = document.querySelectorAll(".prose-cn");
    const last = els[els.length - 1];
    return { txt: last ? last.textContent || "" : "", busy: !!document.querySelector(".animate-pulse") || !!document.querySelector(".animate-bounce") };
  });
  txt = st.txt;
  if (txt.length > 10 && !st.busy) break;
}
await page.waitForTimeout(2000); // 等 persist→云端 upsert
console.log(`② 对话完成：回答 ${txt.length} 字`);

// ③ 云端落库断言
const rows = (await admin.from("chat_sessions").select("id,title,messages,updated_at").eq("user_id", uid).order("updated_at", { ascending: false })).data ?? [];
const target = rows.find((r) => String(r.title).includes("格调") || (Array.isArray(r.messages) && r.messages.some((m) => String(m.content).includes("格调"))));
console.log(`③ 云端 chat_sessions：${before} → ${rows.length} 行；本次会话 ${target ? `✅ 已落库（title=${target.title}，消息 ${target.messages.length} 条）` : "❌ 未找到"}`);
if (target) {
  const roles = target.messages.map((m) => m.role).join(",");
  const noTransient = target.messages.every((m) => !("streaming" in m) && !("toolNote" in m));
  console.log(`   消息结构：[${roles}]｜流式临时字段已剥离 ${noTransient ? "✅" : "❌"}`);
}

// ④ 历史页云端回显（重开页面=本地缓存仍在；清掉 ail-chat 再进，逼它走云端）
await page.evaluate(() => localStorage.removeItem("ail-chat"));
await page.goto(`${BASE}/chat/history`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const hasItem = await page.evaluate((q) => (document.body.textContent || "").includes(q.slice(0, 10)), Q);
console.log(`④ 清本地后历史页云端回显：${hasItem ? "✅ 看得到本次会话" : "❌ 没回显"}`);
await browser.close();
console.log(target && hasItem ? "\n✅ T2.5 对话云同步验证通过" : "\n⚠️ 有项未通过");
