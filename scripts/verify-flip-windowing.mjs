// 验证乱翻窗口化：滚动多屏，统计 <video> 元素数 / 带 src 的视频数 / activeIdx 是否推进
// 解码器 ≈ 带 src 且在加载的视频元素数。核心不变量：任意时刻 ≤ 3，且不随上滑累积增长。
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
let up = false;
for (let i = 0; i < 60; i++) {
  try { await page.goto(BASE + "/flip", { waitUntil: "domcontentloaded", timeout: 5000 }); up = true; break; }
  catch { await page.waitForTimeout(1000); }
}
if (!up) { console.log("❌ server not up"); process.exit(1); }
await page.getByText(/清醒地活|认知觉醒/).first().waitFor({ timeout: 20000 }).catch(() => {});

const snap = async () => page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("video"));
  const withSrc = all.filter((v) => !!v.getAttribute("src"));
  const playing = all.filter((v) => !v.paused);
  const scroller = document.querySelector(".snap-y");
  const idx = scroller ? Math.round(scroller.scrollTop / (scroller.clientHeight || 1)) : -1;
  return { totalVideoEls: all.length, withSrc: withSrc.length, playing: playing.length, idx };
});

const rows = [];
for (let step = 0; step < 12; step++) {
  await page.waitForTimeout(700);
  rows.push({ step, ...(await snap()) });
  await page.evaluate(() => { const el = document.querySelector(".snap-y"); if (el) el.scrollBy({ top: el.clientHeight, behavior: "instant" }); });
}
console.log("step\ttotalVideoEls\twithSrc\tplaying\tidx");
for (const r of rows) console.log(`${r.step}\t${r.totalVideoEls}\t\t${r.withSrc}\t${r.playing}\t${r.idx}`);
await page.waitForTimeout(2500); // 静止后复测：确认任意时刻最多 1 个在播（否则双声音 bug）
const rest = await snap();
console.log(`\n静止后: 元素=${rest.totalVideoEls} 带src=${rest.withSrc} 在播=${rest.playing} idx=${rest.idx}`);
console.log(rest.playing <= 1 ? "✅ 静止后仅 1 个在播（无双声音）" : "⚠️ 静止后多于 1 个在播（双声音 bug）");
const maxEls = Math.max(...rows.map((r) => r.totalVideoEls));
const maxSrc = Math.max(...rows.map((r) => r.withSrc));
console.log(`\n最大 <video> 元素数 = ${maxEls}，最大带 src 数 = ${maxSrc}`);
console.log(maxEls <= 3 && maxSrc <= 3 ? "✅ 窗口化生效：视频元素数恒 ≤3，不累积" : "❌ 窗口化失效：元素数超 3 或随滚动增长");
await browser.close();
