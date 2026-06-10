// UI Review 截图：线上环境关键界面（游客 + 登录态智学真实对话出卡）
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.E2E_BASE || "https://www.goodcontent.cn";
fs.mkdirSync(".e2e/ui-review", { recursive: true });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = async (name, ms = 1800) => { await page.waitForTimeout(ms); await page.screenshot({ path: `.e2e/ui-review/${name}.png` }); console.log("📷", name); };

// 游客视角
await page.goto(`${BASE}/library`, { waitUntil: "domcontentloaded" });
await shot("01-首页", 3000);
await page.goto(`${BASE}/library/book/cognitive-awakening`, { waitUntil: "domcontentloaded" });
await shot("02-详情页", 3000);
await page.goto(`${BASE}/library/book/cognitive-awakening/read`, { waitUntil: "domcontentloaded" });
await shot("03-阅读器", 3000);
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await shot("04-智学欢迎-游客", 2500);
await page.goto(`${BASE}/search`, { waitUntil: "domcontentloaded" });
await shot("05-搜索页", 2500);
await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
await shot("06-我的-游客", 2000);

// 登录态：智学真实对话出推荐卡
await page.waitForTimeout(800);
await page.getByText("登录 / 注册").first().click();
await page.waitForTimeout(800);
await shot("07-登录弹层", 500);
await page.getByText("体验账号（点此一键填入", { exact: false }).click();
await page.waitForTimeout(300);
await page.locator('button[type="submit"]').click();
await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 });
await shot("08-我的-登录", 1000);
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await shot("09-智学欢迎-登录", 2500);
await page.fill("textarea", "推荐一本适合我现在读的书");
await page.keyboard.press("Enter");
// 等流式收尾 + 卡片亮相
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const done = await page.evaluate(() => !document.querySelector(".animate-bounce") && !document.querySelector("textarea[disabled]"));
  const hasCard = await page.evaluate(() => (document.body.textContent || "").length > 0 && !!document.querySelector('a[href*="/library/book/"]'));
  if (done && hasCard) break;
}
await shot("10-智学对话-推荐卡", 2500);
await browser.close();
console.log("✅ 截图完成 .e2e/ui-review/");
