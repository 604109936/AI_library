// T2 UI 审查截图：全 APP 关键页面（亮色 + 暗色样张），供人工过目客观分析
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
fs.mkdirSync(".e2e/t2-review", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.route(/\.(mp4|m3u8|webm)(\?|$)/, (r) => r.abort()); // 截图不等视频
const page = await ctx.newPage();

async function shot(path, name, opts = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(opts.wait ?? 2500);
  if (opts.dark) await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `.e2e/t2-review/${name}.png` });
  console.log("✓", name);
}

// 登录 demo（个性化内容才有真实观感）
await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.getByText("登录 / 注册").first().click();
await page.waitForTimeout(600);
await page.getByText("试试体验账号", { exact: false }).click();
await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 });

await shot("/", "01-首页");
await shot("/library", "02-书库");
await shot("/library/book/b3", "03-书籍详情");
await shot("/library/book/b3/read", "04-阅读器", { wait: 3500 });
await shot("/chat", "05-智学（demo历史对话）");
await shot("/flip", "06-乱翻", { wait: 3500 });
await shot("/me", "07-我的");
await shot("/search", "08-搜索");
// 暗色两张关键页
await page.emulateMedia({ colorScheme: "dark" });
await page.evaluate(() => { document.documentElement.classList.add("dark"); localStorage.setItem("ail-ui", JSON.stringify({ state: { theme: "dark" }, version: 0 })); });
await shot("/chat", "09-智学-暗色");
await shot("/", "10-首页-暗色");
await browser.close();
console.log("✅ 截图完成 .e2e/t2-review/");
