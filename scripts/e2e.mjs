// 浏览器自动验收（Playwright 无头 Chromium，真实执行前端 JS）。
// 用法：先起 dev（端口见 E2E_BASE，默认 3100），再 node scripts/e2e.mjs
//   截图存 .e2e/；抓取控制台报错（含 hydration）。
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const SHOTS = ".e2e";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const consoleErrors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

const shot = async (name) => { try { await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); } catch {} };
async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log("✓ " + name); }
  catch (e) {
    const msg = String(e.message || e).split("\n")[0];
    results.push([false, `${name} — ${msg}`]);
    console.log(`❌ ${name} — ${msg}`);
    await shot("FAIL-" + name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40));
  }
}

// 等 dev 就绪
let up = false;
for (let i = 0; i < 90; i++) {
  try { await page.goto(BASE + "/library", { waitUntil: "domcontentloaded", timeout: 5000 }); up = true; break; }
  catch { await page.waitForTimeout(1000); }
}
if (!up) { console.log("❌ 服务器未就绪：" + BASE); await browser.close(); process.exit(1); }

// 体验账号登录（任意 RequireAuth 页 → 登录/注册 → 体验账号 → 登录）
async function demoLogin() {
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "登录 / 注册" }).click({ timeout: 12000 });
  await page.getByText(/体验账号/).click({ timeout: 8000 });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText(/体验账号/).waitFor({ state: "hidden", timeout: 15000 }); // 登录成功→登录框关闭
}

await step("首页显示真实书《清醒地活》", async () => {
  await page.goto(BASE + "/library", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 15000 });
  await shot("01-home");
});

await step("登录(体验账号)+我的页显示真实昵称「体验书友」", async () => {
  await demoLogin();
  await page.goto(BASE + "/me", { waitUntil: "domcontentloaded" });
  await page.getByText("体验书友").first().waitFor({ timeout: 12000 });
  await shot("02-me");
});

await step("刷新不掉线(会话恢复)", async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("体验书友").first().waitFor({ timeout: 12000 });
});

await step("详情页显示真实书名+作者", async () => {
  await page.goto(BASE + "/library/book/the-untethered-soul", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 15000 });
  await page.getByText(/迈克尔/).first().waitFor({ timeout: 10000 });
  await shot("03-detail");
});

await step("阅读器显示真实正文(18章·第1章脑海中的声音)", async () => {
  await page.goto(BASE + "/library/book/the-untethered-soul/read", { waitUntil: "domcontentloaded" });
  await page.getByText("脑海中的声音").first().waitFor({ timeout: 15000 });
  await shot("06-reader");
});

await step("收藏 → 我的收藏出现该书", async () => {
  await page.goto(BASE + "/library/book/the-untethered-soul", { waitUntil: "domcontentloaded" });
  await page.locator('button:has-text("收藏")').first().click({ timeout: 12000 });
  await page.waitForTimeout(1500);
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 12000 });
  await shot("04-favorites");
});

await step("⭐退出→重登 收藏仍在(数据真入库)", async () => {
  await page.goto(BASE + "/me/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "退出登录" }).first().click({ timeout: 12000 }); // 菜单项
  await page.getByText(/退出后本地的收藏/).waitFor({ timeout: 8000 }); // 二次确认弹层
  await page.getByRole("button", { name: "退出登录" }).last().click({ timeout: 8000 }); // 确认退出
  await page.waitForTimeout(1800);
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByText("登录后查看").waitFor({ timeout: 12000 }); // 已退出
  await demoLogin();
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByText("清醒地活").first().waitFor({ timeout: 12000 }); // 仍在 = 来自 Supabase
  await shot("05-after-relogin");
});

await step("分类「心学」显示共 1 本(真实计数)", async () => {
  await page.goto(BASE + "/library/category/psy", { waitUntil: "domcontentloaded" });
  await page.getByText("共 1 本").waitFor({ timeout: 12000 });
});

// 清理：取消收藏，恢复体验账号干净
try {
  await page.goto(BASE + "/me/favorites", { waitUntil: "domcontentloaded" });
  await page.getByLabel("取消收藏").first().click({ timeout: 6000 });
  await page.waitForTimeout(800);
} catch {}

console.log("\n--- 控制台报错（hydration/运行时）---");
const hydration = consoleErrors.filter((e) => /hydrat|did not match|content does not match/i.test(e));
console.log(`总报错 ${consoleErrors.length} 条；hydration 相关 ${hydration.length} 条`);
[...new Set(consoleErrors)].slice(0, 12).forEach((e) => console.log("  · " + e.slice(0, 180)));

const passed = results.filter(([ok]) => ok).length;
console.log(`\n=== 结果：${passed}/${results.length} 步通过；控制台报错 ${consoleErrors.length}（hydration ${hydration.length}）===`);
await browser.close();
process.exit(passed === results.length && hydration.length === 0 ? 0 : 1);
