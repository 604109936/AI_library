// 验证乱翻视频池：①<video> 元素数恒 ≤3（解码器不累积）②视频随滚动一起移动（跟手，与文字层位置一致，不是固定）
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
let up = false;
for (let i = 0; i < 60; i++) { try { await page.goto(BASE + "/flip", { waitUntil: "domcontentloaded", timeout: 5000 }); up = true; break; } catch { await page.waitForTimeout(1000); } }
if (!up) { console.log("❌ server not up"); process.exit(1); }
await page.getByText(/清醒地活|认知觉醒/).first().waitFor({ timeout: 20000 }).catch(() => {});

// 元素数 + 半屏滚动后「视频 vs 文字层」对齐
const rows = [];
for (let step = 0; step < 10; step++) {
  await page.waitForTimeout(500);
  const c = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("video"));
    const scroller = document.querySelector(".snap-y");
    const idx = scroller ? Math.round(scroller.scrollTop / (scroller.clientHeight || 1)) : -1;
    return { totalVideoEls: all.length, withSrc: all.filter((v) => v.getAttribute("src")).length, idx };
  });
  rows.push({ step, ...c });
  await page.evaluate(() => { const el = document.querySelector(".snap-y"); if (el) el.scrollBy({ top: el.clientHeight, behavior: "instant" }); });
}

// 半屏滚动对齐：滚到 2.5 屏（slide2/3 之间），等重渲染，再比对「视频」与「文字层」rect.top 是否同位（证明视频随内容滚、跟手）
await page.evaluate(() => { const el = document.querySelector(".snap-y"); el.scrollTo({ top: 2.5 * el.clientHeight, behavior: "instant" }); });
await page.waitForTimeout(900); // 等 scroll→activeIdx→重渲染→视频重定位
const align = await page.evaluate(() => {
  const el = document.querySelector(".snap-y");
  const base = el.getBoundingClientRect().top;
  const slideEls = Array.from(el.querySelectorAll("div.snap-start"));
  const vids = Array.from(el.querySelectorAll("video")).filter((v) => v.getAttribute("src"));
  const slideTops = slideEls.map((s) => Math.round(s.getBoundingClientRect().top - base));
  const vidTops = vids.map((v) => Math.round(v.getBoundingClientRect().top - base));
  // 当前可见的两条文字层（rect.top 在 [-h, h) 内）应各有一个视频 top 与之一致
  const h = el.clientHeight;
  const visibleSlides = slideTops.filter((t) => t > -h + 5 && t < h - 5);
  const matched = visibleSlides.every((st) => vidTops.some((vt) => Math.abs(vt - st) <= 3));
  return { vidTops, visibleSlides, matched };
});

console.log("step\t元素数\t带src\tidx");
for (const r of rows) console.log(`${r.step}\t${r.totalVideoEls}\t${r.withSrc}\t${r.idx}`);
const maxEls = Math.max(...rows.map((r) => r.totalVideoEls));
console.log(`\n最大 <video> 元素数 = ${maxEls}  →  ${maxEls <= 3 ? "✅ ≤3，解码器不累积" : "❌ 超 3"}`);
console.log(`\n半屏滚动对齐：可见文字层 top=${JSON.stringify(align?.visibleSlides)}px，所有视频 top=${JSON.stringify(align?.vidTops)}px`);
console.log(align?.matched ? "✅ 每个可见文字层都有同位视频 → 视频随内容滚动（跟手，非固定）" : "❌ 视频与文字层不同位（视频未跟随滚动）");
await browser.close();
