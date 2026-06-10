// 诊断：无头浏览器里 UI 登录到底卡在哪
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 160)); });
await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.getByText("登录 / 注册").first().click();
await page.waitForTimeout(600);
await page.getByText("体验账号（点此一键填入", { exact: false }).click();
await page.waitForTimeout(300);
const filled = await page.evaluate(() => Array.from(document.querySelectorAll("input")).map((i) => ({ ph: i.placeholder, len: i.value.length })));
console.log("填入情况:", JSON.stringify(filled));
await page.locator('button[type="submit"]').click();
for (let i = 1; i <= 12; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({
    err: document.querySelector("p.text-rouge")?.textContent ?? "", // 只看真正的错误段落
    sheetOpen: !!document.querySelector('button[type="submit"]'),
    token: Object.keys(localStorage).filter((k) => k.includes("auth-token")).length,
    nick: (document.body.textContent || "").includes("编辑资料"),
  }));
  console.log(`t+${i}s`, JSON.stringify(st));
  if (st.nick || st.err) break;
}
await page.screenshot({ path: ".e2e/debug-login.png" });
await browser.close();
