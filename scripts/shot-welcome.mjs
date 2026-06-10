// 复核智学新欢迎页：游客版 + demo 登录版（个性化问候/开场白/动态问题/续聊条）
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
fs.mkdirSync(".e2e/ui-review", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.screenshot({ path: ".e2e/ui-review/welcome-游客.png" });

await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.getByText("登录 / 注册").first().click();
await page.waitForTimeout(600);
await page.getByText("试试体验账号", { exact: false }).click();
await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 });
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.screenshot({ path: ".e2e/ui-review/welcome-登录.png" });
await browser.close();
console.log("✅ 截图完成");
