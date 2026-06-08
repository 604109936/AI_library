// 浏览器自动验收（Playwright 无头 Chromium，真实执行前端 JS）。
// 用法：先起 dev（默认 3100），再 node --env-file=.env.local scripts/e2e.mjs
//   截图存 .e2e/；抓控制台报错（含 hydration）；跑完用 service_role 清理测试数据。
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const SHOTS = ".e2e";
mkdirSync(SHOTS, { recursive: true });
const REG_EMAIL = `e2e_${Date.now()}@example.com`;

const results = [];
const consoleErrors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

const shot = async (n) => { try { await page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }); } catch {} };
async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log("✓ " + name); }
  catch (e) {
    const msg = String(e.message || e).split("\n")[0];
    results.push([false, `${name} — ${msg}`]);
    console.log(`❌ ${name} — ${msg}`);
    await shot("FAIL-" + name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 36));
  }
}
const openLoginSheet = async () => {
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "登录 / 注册" }).click({ timeout: 12000 });
};
async function demoLogin() {
  await openLoginSheet();
  await page.getByText(/体验账号/).click({ timeout: 8000 });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText(/体验账号/).waitFor({ state: "hidden", timeout: 15000 });
}

// 等 dev 就绪
let up = false;
for (let i = 0; i < 90; i++) {
  try { await page.goto(BASE + "/library", { waitUntil: "domcontentloaded", timeout: 5000 }); up = true; break; }
  catch { await page.waitForTimeout(1000); }
}
if (!up) { console.log("❌ 服务器未就绪：" + BASE); await browser.close(); process.exit(1); }

await step("1.首页显示真实书《清醒地活》", async () => {
  await page.goto(BASE + "/library", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 15000 });
  await shot("01-home");
});

await step("6.注册校验：已注册邮箱报错 + 短密码禁用提交", async () => {
  await openLoginSheet();
  await page.getByText("没有账号？立即注册").click({ timeout: 8000 });
  // 短密码 → 提交禁用
  await page.getByPlaceholder("邮箱").fill("demo@ailibrary.app");
  await page.getByPlaceholder("昵称").fill("x");
  await page.getByPlaceholder(/密码（至少/).fill("123");
  await page.getByPlaceholder("确认密码").fill("123");
  if (!(await page.getByRole("button", { name: "注册", exact: true }).isDisabled())) throw new Error("短密码时注册按钮应禁用");
  // 已注册邮箱 → 报错
  await page.getByPlaceholder(/密码（至少/).fill("123456");
  await page.getByPlaceholder("确认密码").fill("123456");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByText(/已注册/).waitFor({ timeout: 10000 });
  await page.getByText("先逛逛").click().catch(() => {});
});

await step("1-3.登录(体验账号)+我的页真实昵称「体验书友」", async () => {
  await demoLogin();
  await page.goto(BASE + "/me", { waitUntil: "domcontentloaded" });
  await page.getByText("体验书友").first().waitFor({ timeout: 12000 });
  await shot("02-me");
});

await step("4.刷新不掉线(会话恢复)", async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("体验书友").first().waitFor({ timeout: 12000 });
});

await step("8.详情页真实书名+作者", async () => {
  await page.goto(BASE + "/library/book/the-untethered-soul", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 15000 });
  await page.getByText(/迈克尔/).first().waitFor({ timeout: 10000 });
  await shot("03-detail");
});

await step("9.阅读器真实正文(第1章·脑海中的声音)", async () => {
  await page.goto(BASE + "/library/book/the-untethered-soul/read", { waitUntil: "domcontentloaded" });
  await page.getByText("脑海中的声音").first().waitFor({ timeout: 15000 });
  await shot("06-reader");
});

await step("11.搜索：命中真实书 + 无结果", async () => {
  await page.goto(BASE + "/search", { waitUntil: "networkidle" });
  const box = page.getByPlaceholder(/搜索/);
  await box.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500); // 等水合完成，避免 fill 被重置
  await box.fill("清醒");
  await page.getByText("清醒地活").first().waitFor({ timeout: 12000 });
  await box.fill("zzzznotabook");
  await page.waitForTimeout(1200);
  if ((await page.getByText("清醒地活").count()) !== 0) throw new Error("无结果查询仍显示了书");
  await shot("07-search");
});

await step("13.收藏 → 我的收藏出现该书", async () => {
  await page.goto(BASE + "/library/book/the-untethered-soul", { waitUntil: "domcontentloaded" });
  await page.locator('button:has-text("收藏")').first().click({ timeout: 12000 });
  await page.waitForTimeout(1500);
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 12000 });
  await shot("04-favorites");
});

await step("15.写书评 → 我的书评出现", async () => {
  await page.goto(BASE + "/library/book/the-untethered-soul/review/new", { waitUntil: "domcontentloaded" });
  await page.getByLabel("5 星", { exact: true }).click({ timeout: 12000 });
  await page.locator("textarea").first().fill("自动化验收写下的书评内容，至少十个字。");
  await page.getByRole("button", { name: "发布" }).click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.goto(BASE + "/me/reviews", { waitUntil: "domcontentloaded" });
  await page.getByText(/自动化验收写下的书评/).first().waitFor({ timeout: 10000 });
  await shot("08-myreviews");
});

await step("16.读章(滚到底) → 我的历史出现该书", async () => {
  await page.goto(BASE + "/library/book/the-untethered-soul/read", { waitUntil: "domcontentloaded" });
  await page.getByText("脑海中的声音").first().waitFor({ timeout: 12000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1800);
  await page.goto(BASE + "/me/history", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 10000 });
  await shot("09-history");
});

await step("19.收藏页排序切换(最新↔最早)", async () => {
  await page.goto(BASE + "/me/favorites", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /最新收藏/ }).first().click({ timeout: 8000 });
  await page.getByRole("button", { name: "最早收藏" }).click({ timeout: 6000 });
  await page.getByRole("button", { name: /最早收藏/ }).first().waitFor({ timeout: 5000 });
});

await step("17.⭐退出→重登 收藏仍在(数据真入库)", async () => {
  await page.goto(BASE + "/me/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出登录" }).first().click({ timeout: 12000 });
  await page.getByText(/退出后本地的收藏/).waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "退出登录" }).last().click({ timeout: 8000 });
  await page.waitForTimeout(1800);
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByText("登录后查看").waitFor({ timeout: 12000 });
  await demoLogin();
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 12000 });
  await shot("05-after-relogin");
});

await step("18.分类「心学」显示共 1 本(真实计数)", async () => {
  await page.goto(BASE + "/library/category/psy", { waitUntil: "domcontentloaded" });
  await page.getByText("共 1 本").waitFor({ timeout: 12000 });
});

// 放最后：注册新号会切换登录用户
await step("5.注册新邮箱 → 自动登录显示新昵称", async () => {
  // 先退出当前(体验账号)
  await page.goto(BASE + "/me/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出登录" }).first().click({ timeout: 12000 });
  await page.getByText(/退出后本地的收藏/).waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "退出登录" }).last().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await openLoginSheet();
  await page.getByText("没有账号？立即注册").click({ timeout: 8000 });
  await page.getByPlaceholder("邮箱").fill(REG_EMAIL);
  await page.getByPlaceholder("昵称").fill("E2E新用户");
  await page.getByPlaceholder(/密码（至少/).fill("e2e123456");
  await page.getByPlaceholder("确认密码").fill("e2e123456");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByText(/体验账号/).waitFor({ state: "hidden", timeout: 15000 });
  await page.goto(BASE + "/me", { waitUntil: "domcontentloaded" });
  await page.getByText("E2E新用户").first().waitFor({ timeout: 10000 });
});

await browser.close();

// ---- 用 service_role 清理测试数据 ----
try {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers();
  const users = list?.users ?? [];
  const demo = users.find((u) => u.email === "demo@ailibrary.app");
  if (demo) {
    for (const t of ["favorites", "notes", "reviews", "reading_history", "text_progress", "media_progress"]) {
      await admin.from(t).delete().eq("user_id", demo.id);
    }
    await admin.from("profiles").update({ read_seconds: 0 }).eq("id", demo.id);
  }
  // 删本次及历史 e2e_ 注册测试用户
  for (const u of users.filter((u) => (u.email || "").startsWith("e2e_"))) {
    await admin.auth.admin.deleteUser(u.id);
  }
  console.log("✓ 已清理：体验账号测试数据 + e2e_ 注册用户");
} catch (e) {
  console.log("⚠️ 清理告警：" + (e.message || e));
}

console.log("\n--- 控制台报错（hydration/运行时）---");
const hydration = consoleErrors.filter((e) => /hydrat|did not match|content does not match/i.test(e));
console.log(`总报错 ${consoleErrors.length} 条；hydration 相关 ${hydration.length} 条`);
[...new Set(consoleErrors)].slice(0, 12).forEach((e) => console.log("  · " + e.slice(0, 180)));

const passed = results.filter(([ok]) => ok).length;
console.log(`\n=== 结果：${passed}/${results.length} 步通过；控制台报错 ${consoleErrors.length}（hydration ${hydration.length}）===`);
process.exit(passed === results.length && hydration.length === 0 ? 0 : 1);
