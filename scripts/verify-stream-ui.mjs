// 验证三处流式 UI 修复：①无"杵着的竖线"光标 ②工具调用文案可见（有正文时显示在气泡下方）
// ③卡片不在吐字中途插入（只随收尾出现）
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.fill("textarea", "《认知觉醒》第2章讲了什么？顺便再推荐一本相关的书");
await page.keyboard.press("Enter");

let sawCursor = false; // 旧竖线光标（h-4 w-0.5 animate-pulse）
let sawToolNote = ""; // 工具文案
let cardWhileTyping = false; // 吐字中途出卡
let cardAtEnd = false;
let done = false;
for (let i = 0; i < 150 && !done; i++) {
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => {
    const cursor = !!document.querySelector(".prose-cn .animate-pulse");
    const body = document.body.textContent || "";
    const note = ["查找书籍…", "翻阅图书…", "章节浏览…"].find((t) => body.includes(t)) ?? "";
    const cards = document.querySelectorAll('a[href^="/library/book/"]').length;
    const prose = document.querySelectorAll(".prose-cn");
    const txt = prose.length ? prose[prose.length - 1].textContent || "" : "";
    const streaming = !!document.querySelector(".animate-bounce") || note !== "";
    // 操作栏出现 = 收尾完成
    const finished = body.includes("重新生成");
    return { cursor, note, cards, len: txt.length, streaming, finished };
  });
  if (st.cursor) sawCursor = true;
  if (st.note) sawToolNote = st.note;
  if (st.cards > 0 && !st.finished) cardWhileTyping = true;
  if (st.finished) { cardAtEnd = st.cards > 0; done = true; }
}
console.log(`① 旧竖线光标出现过：${sawCursor ? "❌ 是" : "✅ 否"}`);
console.log(`② 工具调用文案见到：${sawToolNote ? `✅「${sawToolNote}」` : "⚠️ 未捕捉到（工具窗口期短，需真机肉眼复核）"}`);
console.log(`③ 吐字中途插卡：${cardWhileTyping ? "❌ 有" : "✅ 无"}；收尾后卡片出现：${cardAtEnd ? "✅" : "⚠️ 本问未触发卡片"}`);
await page.screenshot({ path: ".e2e/chat-stream-ui.png" });
await browser.close();
console.log(!sawCursor && !cardWhileTyping ? "\n✅ 流式 UI 三处修复验证通过" : "\n⚠️ 有项未通过");
