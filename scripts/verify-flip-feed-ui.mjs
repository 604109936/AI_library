// T3.2 验证：乱翻前端真读 flip_feed
//   ① 登录态：乱翻前 5 条顺序 = demo 个性化 feed 前 5 本（feed 序与回退序第 4 条起分叉，足以区分）
//   ② 游客：乱翻前 5 条顺序 = 回退池前 5 本（最新入库序）
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

// 预期序列：demo feed 前 5 本 / 回退池前 5 本
const N = 5;
const { data: users } = await admin.auth.admin.listUsers();
const demo = users.users.find((u) => u.email === "demo@ailibrary.app");
const { data: feedRow } = await admin.from("flip_feed").select("book_ids").eq("user_id", demo.id).order("gen_date", { ascending: false }).limit(1).maybeSingle();
const { data: feedBooks } = await admin.from("books").select("id,title").in("id", feedRow.book_ids.slice(0, N));
const tmap = new Map(feedBooks.map((b) => [b.id, b.title]));
const expFeed = feedRow.book_ids.slice(0, N).map((id) => tmap.get(id));
const { data: fbBooks } = await admin.from("books").select("title").eq("has_video", true).order("shelved_at", { ascending: false }).limit(N);
const expFallback = fbBooks.map((b) => b.title);
console.log(`预期登录序：${expFeed.join(" → ")}\n预期游客序：${expFallback.join(" → ")}`);
if (expFeed.join() === expFallback.join()) { console.log("⚠️ 两序列相同，断言无区分度，请先让 demo 产生差异化数据"); process.exit(1); }

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });

// 依次下滑收集前 N 条标题（取「当前可视屏内」的 h2——相邻条 overlay 同时渲染，需按视口命中筛）
async function flipTitles(page, n) {
  await page.goto(`${BASE}/flip`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main h2", { timeout: 20000 }).catch(() => {});
  const titles = [];
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(700);
    titles.push(await page.evaluate(() => {
      const hit = Array.from(document.querySelectorAll("main h2")).find((el) => {
        const r = el.getBoundingClientRect();
        return r.top > 0 && r.top < innerHeight;
      });
      return hit?.textContent?.trim() ?? "";
    }));
    await page.evaluate(() => { const el = document.querySelector(".snap-y"); if (el) el.scrollBy({ top: el.clientHeight, behavior: "instant" }); });
  }
  return titles;
}

// ① 登录态
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.getByText("登录 / 注册").first().click();
  await page.waitForTimeout(600);
  await page.getByText("试试体验账号", { exact: false }).click(); // C1 后一键直接登录（自动提交）
  await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 }).catch(() => {});
  const got = await flipTitles(page, N);
  ok(got.join() === expFeed.join(), "登录态乱翻顺序 = 个性化 feed 序", `实际 ${got.join(" → ")}`);
  await ctx.close();
}

// ② 游客
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const got = await flipTitles(page, N);
  ok(got.join() === expFallback.join(), "游客乱翻顺序 = 回退池序（最新入库）", `实际 ${got.join(" → ")}`);
  await ctx.close();
}

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
