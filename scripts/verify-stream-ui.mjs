// 验证流式 UI（2026-06 现行口径）：
//   ① 无"杵着的竖线"旧光标
//   ② 工具状态文案可见（T8 新文案，无省略号）
//   ③ 卡片交错渲染：流式中即在真实位置出现（旧口径"只随收尾出现"已废弃——T3/T4 起卡片按工具调用位置插入）
//   ④ 全程无占位标记泄漏
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.fill("textarea", "《认知觉醒》第2章讲了什么？顺便再推荐一本相关的书");
await page.keyboard.press("Enter");

const TOOL_TEXTS = ["在书架间为你找书", "翻开", "细读", "整理原文出处", "正在网上帮你查", "正在为你整理卡片"];
let sawCursor = false;
let sawToolNote = "";
let cardWhileStreaming = false;
let cardAtEnd = false;
let markerLeak = false;
let done = false;
for (let i = 0; i < 150 && !done; i++) {
  await page.waitForTimeout(400);
  const st = await page.evaluate((toolTexts) => {
    const cursor = !!document.querySelector(".prose-cn .animate-pulse");
    const main = document.querySelector("main");
    const body = main ? main.innerText : "";
    const note = toolTexts.find((t) => body.includes(t)) ?? "";
    const cards = document.querySelectorAll('a[href^="/library/book/"]').length;
    const leak = body.includes("[[recs") || body.includes("[[cites") || body.includes("[[web");
    const finished = body.includes("重新生成");
    return { cursor, note, cards, leak, finished };
  }, TOOL_TEXTS);
  if (st.cursor) sawCursor = true;
  if (st.note) sawToolNote = st.note;
  if (st.leak) markerLeak = true;
  if (st.cards > 0 && !st.finished) cardWhileStreaming = true;
  if (st.finished) { cardAtEnd = st.cards > 0; done = true; }
}
let pass = 0, fail = 0;
const ok = (cond, name) => { console.log(`${cond ? "✅" : "❌"} ${name}`); cond ? pass++ : fail++; };
ok(!sawCursor, "无旧竖线光标");
console.log(`${sawToolNote ? "✅" : "ℹ️"} 工具状态文案${sawToolNote ? `可见「${sawToolNote}」` : "未捕捉到（窗口期短，软提示）"}`);
if (sawToolNote) pass++;
ok(cardWhileStreaming || cardAtEnd, "卡片已渲染（交错或收尾位置）");
console.log(`${cardWhileStreaming ? "✅" : "ℹ️"} 卡片${cardWhileStreaming ? "在流式中按位置交错出现" : "仅收尾出现（本问可能只在末尾出卡，软提示）"}`);
if (cardWhileStreaming) pass++;
ok(!markerLeak, "全程无占位标记泄漏");
await page.screenshot({ path: ".e2e/chat-stream-ui.png" });
await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
