// 乱翻页截图（验证 UI）：node scripts/shot-flip.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
mkdirSync(".e2e", { recursive: true });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
let up = false;
for (let i = 0; i < 60; i++) {
  try { await page.goto(BASE + "/flip", { waitUntil: "domcontentloaded", timeout: 5000 }); up = true; break; }
  catch { await page.waitForTimeout(1000); }
}
if (!up) { console.log("❌ server not up"); process.exit(1); }
await page.getByText(/清醒地活|认知觉醒/).first().waitFor({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: ".e2e/flip-loading.png" }); // 可能抓到加载态
await page.waitForTimeout(11000); // 多等，让阿里云 OSS 视频在无头里起播
await page.screenshot({ path: ".e2e/flip-playing.png" }); // 播放态
console.log("✓ 截图已存 .e2e/flip-loading.png / flip-playing.png");
await browser.close();
