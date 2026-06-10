// T3.3/T3.4/T4.3/T4.4 端到端验证（真实浏览器 + 库内核验，测试数据用后即清）：
//   ① 搜索上报：游客搜「认知」有结果 → search_logs 落一条（user_id 空）且同词不重复记
//   ② 热门聚合：get_hot_searches 返回「认知」；搜索页热门区出现该词
//   ③ 意见反馈：登录提交 → feedback 表落库
//   ④ 头像上传：选图 → 保存 → Storage 出现 avatars/<uid>/avatar.jpg + profiles.avatar_url 指向它
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

const TERM = "认知"; // 命中《认知觉醒》
await admin.from("search_logs").delete().eq("term", TERM); // 清旧测试残留

const browser = await chromium.launch();

/* ---------- ① + ② 搜索上报 & 热门聚合（游客） ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/search`, { waitUntil: "domcontentloaded" });
  await page.fill("input", TERM);
  await page.waitForFunction(() => (document.body.textContent || "").includes("认知觉醒"), { timeout: 15000 });
  await page.waitForTimeout(1500); // 等 fire-and-forget 落库
  // 再搜一次同词（清空→重输），验证库内去重
  await page.fill("input", "");
  await page.waitForTimeout(500);
  await page.fill("input", TERM);
  await page.waitForFunction(() => (document.body.textContent || "").includes("认知觉醒"), { timeout: 15000 });
  await page.waitForTimeout(1500);
  const { data: logs } = await admin.from("search_logs").select("id,user_id").eq("term", TERM);
  ok(logs?.length === 1, "有效搜索落一条 search_logs（同词去重）", `${logs?.length} 条`);
  ok(logs?.[0]?.user_id === null, "游客搜索 user_id 为空");

  const { data: hot } = await admin.rpc("get_hot_searches", { p_limit: 20, p_days: 30 });
  ok(Array.isArray(hot) && hot.includes(TERM), "get_hot_searches 聚合出该词", JSON.stringify(hot));

  // 热门区 UI 出现该词（新开页，绕过本页 10 分钟模块缓存）
  const page2 = await ctx.newPage();
  await page2.goto(`${BASE}/search`, { waitUntil: "domcontentloaded" });
  await page2.waitForFunction(() => (document.body.textContent || "").includes("热门搜索"), { timeout: 15000 }).catch(() => {});
  const chip = await page2.getByRole("button", { name: TERM, exact: true }).count();
  ok(chip > 0, "搜索页热门区出现聚合词");
  await ctx.close();
}

/* ---------- ③ + ④ 反馈落库 & 头像上传（登录态） ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.getByText("登录 / 注册").first().click();
  await page.waitForTimeout(600);
  await page.getByText("体验账号（点此一键填入", { exact: false }).click();
  await page.waitForTimeout(300);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 });

  const { data: users } = await admin.auth.admin.listUsers();
  const demo = users.users.find((u) => u.email === "demo@ailibrary.app");

  // ③ 反馈
  const FB = `自动化测试反馈 ${Date.now()}`;
  await page.goto(`${BASE}/me/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.getByText("意见反馈").click();
  await page.waitForTimeout(500);
  await page.fill("textarea", FB);
  await page.getByText("提交反馈").click();
  await page.waitForFunction(() => (document.body.textContent || "").includes("感谢反馈"), { timeout: 10000 }).catch(() => {});
  const { data: fb } = await admin.from("feedback").select("id,user_id,content").eq("content", FB);
  ok(fb?.length === 1 && fb[0].user_id === demo.id, "反馈落库且归属本人", `${fb?.length ?? 0} 条`);
  if (fb?.length) await admin.from("feedback").delete().eq("id", fb[0].id);

  // ④ 头像上传（备份现值，测完还原，不污染 demo）
  const { data: beforeProf } = await admin.from("profiles").select("avatar_url").eq("id", demo.id).single();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.goto(`${BASE}/me/settings/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.getByLabel("更换头像").click();
  await page.waitForTimeout(400);
  await page.setInputFiles('input[type="file"]', { name: "test.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => (document.body.textContent || "").includes("头像已选好"), { timeout: 10000 });
  await page.getByText("保存", { exact: true }).click();
  await page.waitForTimeout(2500); // 等上传 + 写库 + 返回
  const { data: afterProf } = await admin.from("profiles").select("avatar_url").eq("id", demo.id).single();
  const expectPath = `/storage/v1/object/public/avatars/${demo.id}/avatar.jpg`;
  ok(!!afterProf?.avatar_url && afterProf.avatar_url.includes(expectPath), "profiles.avatar_url 指向 Storage 公网地址", afterProf?.avatar_url ?? "空");
  const { data: objs } = await admin.storage.from("avatars").list(demo.id);
  ok((objs ?? []).some((o) => o.name === "avatar.jpg"), "Storage 中存在 avatars/<uid>/avatar.jpg");
  // 还原
  await admin.from("profiles").update({ avatar_url: beforeProf?.avatar_url ?? null }).eq("id", demo.id);
  await admin.storage.from("avatars").remove([`${demo.id}/avatar.jpg`]);
  await ctx.close();
}

await admin.from("search_logs").delete().eq("term", TERM); // 清测试词
await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
