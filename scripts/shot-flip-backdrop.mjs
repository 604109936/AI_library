// 复核乱翻封面垫底图新构图：屏蔽视频请求 → 垫底图持续可见（暗底 blur 氛围 + 居中适中锐利封面）
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
fs.mkdirSync(".e2e/ui-review", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.route(/\.(mp4|m3u8|webm)(\?|$)/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto(`${BASE}/flip`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await page.screenshot({ path: ".e2e/ui-review/乱翻-封面垫底.png" });
await browser.close();
console.log("✅ 截图完成");
