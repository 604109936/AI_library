// 验证对话云同步（T4 单一会话版）：登录态对话 → 落库到唯一会话 main → 清本地后重进页面云端回显
// demo 是共享体验账号：开测前备份 main 原样，测后恢复（绝不残留测试消息）
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;

// ① demo 登录 + 备份 main 原样
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
if (error) { console.log("❌ demo 登录失败:", error.message); process.exit(1); }
const uid = auth.user.id;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: backup } = await admin.from("chat_sessions").select("*").eq("user_id", uid).eq("id", "main").maybeSingle();
console.log(`① 已备份 demo main（原 ${backup ? backup.messages.length : 0} 条消息）`);

async function restore() {
  if (backup) await admin.from("chat_sessions").upsert(backup, { onConflict: "user_id,id" });
  else await admin.from("chat_sessions").delete().eq("user_id", uid).eq("id", "main");
  console.log("⑤ demo main 已恢复原样");
}

try {
  // ② 浏览器 UI 登录 → 智学发问 → 等回答完成
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.getByText("登录 / 注册").first().click();
  await page.waitForTimeout(600);
  await page.getByText("试试体验账号", { exact: false }).click();
  await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 }).catch(() => {});
  const logged = await page.evaluate(() => (document.body.textContent || "").includes("编辑资料"));
  console.log(`①.5 UI 登录：${logged ? "✅" : "❌ 未见登录态"}`);
  if (!logged) { await browser.close(); await restore(); process.exit(1); }
  await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const Q = "用一句话介绍馆里的《格调》";
  await page.fill("textarea", Q);
  await page.keyboard.press("Enter");
  let txt = "";
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    const st = await page.evaluate(() => {
      const els = document.querySelectorAll(".prose-cn");
      const last = els[els.length - 1];
      return { txt: last ? last.textContent || "" : "", busy: !!document.querySelector(".animate-bounce") || (document.body.textContent || "").includes("停止生成") };
    });
    txt = st.txt;
    if (txt.length > 10 && !st.busy && i > 3) break;
  }
  await page.waitForTimeout(2000); // 等 persist→云端 upsert
  console.log(`② 对话完成：回答 ${txt.length} 字`);

  // ③ 云端落库断言：main 行追加了本次问答
  const { data: row } = await admin.from("chat_sessions").select("id,title,messages").eq("user_id", uid).eq("id", "main").maybeSingle();
  const baseLen = backup ? backup.messages.length : 0;
  const appended = !!row && row.messages.length >= baseLen + 2 && row.messages.some((m) => String(m.content).includes("格调"));
  console.log(`③ 云端 main：${baseLen} → ${row?.messages.length ?? 0} 条；本次问答 ${appended ? "✅ 已追加" : "❌ 未找到"}`);
  if (row) {
    const noTransient = row.messages.every((m) => !("streaming" in m) && !("toolNote" in m));
    console.log(`   流式临时字段已剥离 ${noTransient ? "✅" : "❌"}`);
  }

  // ④ 清本地后重进 /chat：单一会话从云端回显
  await page.evaluate(() => localStorage.removeItem("ail-chat"));
  await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const echoed = await page.evaluate((q) => (document.body.textContent || "").includes(q.slice(0, 10)), Q);
  console.log(`④ 清本地后重进智学页云端回显：${echoed ? "✅ 看得到本次对话" : "❌ 没回显"}`);
  await browser.close();

  await restore();
  console.log(appended && echoed ? "\n✅ 单一会话云同步验证通过" : "\n⚠️ 有项未通过");
  process.exit(appended && echoed ? 0 : 1);
} catch (e) {
  await restore();
  throw e;
}
