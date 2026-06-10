// 验证「章节读毕」判定修复（断言一律走详情页 DOM 的「已读 ✓」，即用户真实可见口径；
// 注意 useLibrary 自阶段3.5 起不再持久化 localStorage，不能读 ail-library 断言）：
// 场景① 读到 40% 停 6 秒（覆盖 5s 定时器一拍）退出 → 章节行不应有 ✓（修复前：退出即误打√）
// 场景② 滚到底再退出 → 章节行应有 ✓；没读过的下一章不应有 ✓
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const ID = process.env.BOOK_ID || "the-untethered-soul";
const CH = `${ID}-c2`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
// 干净起点：清空 localStorage（含 Supabase 会话）→ 游客态，内存 store 从零开始，不污染云端数据
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });

let up = false;
for (let i = 0; i < 60; i++) { try { await page.goto(`${BASE}/library/book/${ID}`, { waitUntil: "domcontentloaded", timeout: 5000 }); up = true; break; } catch { await page.waitForTimeout(1000); } }
if (!up) { console.log("❌ server not up"); process.exit(1); }

// 详情页章节行是否带「已读 ✓」（lucide Check 图标）
const rowChecked = (ch) => page.evaluate((c) => !!document.querySelector(`a[href*="ch=${c}"] svg.lucide-check`), ch);

const enterChapter = async () => {
  await page.waitForSelector(`a[href*="ch=${CH}"]`, { timeout: 20000 });
  await page.click(`a[href*="ch=${CH}"]`); // SPA 导航，保留历史使「返回」真实触发卸载 cleanup
  await page.waitForFunction(() => { const el = document.querySelector(".break-words"); return el && (el.textContent || "").length > 200; }, { timeout: 20000 });
  await page.waitForTimeout(600);
};
const scrollTo = (ratio) => page.evaluate((r) => {
  const el = document.querySelector(".break-words")?.parentElement; // contentRef 的父级 = 阅读器滚动容器
  if (!el) return -1;
  el.scrollTop = (el.scrollHeight - el.clientHeight) * r;
  return el.scrollHeight - el.clientHeight;
}, ratio);
const goBack = async () => {
  await page.click('header button[aria-label="返回"]');
  await page.waitForSelector(`a[href*="ch=${CH}"]`, { timeout: 20000 }); // 回到详情页章节列表
  await page.waitForTimeout(400);
};

// 基线：进入前 c2 不应有 ✓（游客态从零开始）
const base = await rowChecked(CH);
console.log(`基线 c2 勾=${base} → ${base === false ? "✅" : "❌ 起点已脏"}`);

// 场景①：40% + 停 6 秒 + 退出 → 不应有 ✓
await enterChapter();
const max1 = await scrollTo(0.4);
await page.waitForTimeout(6200);
await goBack();
const after40 = await rowChecked(CH);
const pass1 = after40 === false;
console.log(`场景① 40%+6s 退出：c2 勾=${after40} → ${pass1 ? "✅ 未误判读毕" : "❌ 被误判读毕"}（本章可滚高度 ${max1}px）`);

// 场景②：滚到底 + 退出 → 应有 ✓；c3 未读不应有 ✓
await enterChapter();
await scrollTo(1);
await page.waitForTimeout(900); // 等 onScroll 落账
await goBack();
const afterFull = await rowChecked(CH);
const c3 = await rowChecked(`${ID}-c3`);
const pass2 = afterFull === true && c3 === false;
console.log(`场景② 滚到底退出：c2 勾=${afterFull} c3 勾=${c3} → ${pass2 ? "✅ 正确判读毕且不殃及他章" : "❌"}`);

const ok = base === false && pass1 && pass2;
console.log(ok ? "\n✅ 章节读毕判定修复验证通过" : "\n⚠️ 有场景未通过");
await browser.close();
process.exit(ok ? 0 : 1);
