// 验证阅读器：① Markdown 真的渲染成元素(非生符号) ② 选中文本能触发划线菜单(locate 命中)
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
const ID = process.env.BOOK_ID || "the-untethered-soul";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
let up = false;
for (let i = 0; i < 60; i++) { try { await page.goto(`${BASE}/library/book/${ID}/read`, { waitUntil: "domcontentloaded", timeout: 5000 }); up = true; break; } catch { await page.waitForTimeout(1000); } }
if (!up) { console.log("❌ server not up"); process.exit(1); }

// 等正文渲染
await page.waitForFunction(() => { const el = document.querySelector(".break-words"); return el && (el.textContent || "").length > 50; }, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
// 翻到正式章节（前言常为纯散文，看不到 markdown 结构）
const ADV = +(process.env.ADV || 2);
for (let k = 0; k < ADV; k++) { await page.getByRole("button", { name: "下一章" }).click().catch(() => {}); await page.waitForTimeout(700); }

const md = await page.evaluate(() => {
  const el = document.querySelector(".break-words");
  if (!el) return { ok: false };
  const tags = {};
  el.querySelectorAll("h1,h2,h3,strong,em,ul,ol,li,blockquote,hr,p,code").forEach((n) => { tags[n.tagName.toLowerCase()] = (tags[n.tagName.toLowerCase()] || 0) + 1; });
  const txt = el.textContent || "";
  const rawMd = /(^|\n)#{1,3}\s/.test(txt) || /\*\*[^*]+\*\*/.test(txt); // 仍残留生 markdown 符号？
  return { ok: true, tags, rawLeak: rawMd, sample: txt.slice(0, 80) };
});

// 模拟在正文里选一段文字 → 应触发划线菜单(.fixed.z-50 内含色块按钮)
const sel = await page.evaluate(() => {
  const el = document.querySelector(".break-words");
  if (!el) return { selected: "" };
  // 找一个较长的文本节点选中其中一段
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node; while ((node = w.nextNode())) { if ((node.nodeValue || "").trim().length > 12) break; }
  if (!node) return { selected: "" };
  const r = document.createRange();
  r.setStart(node, 2); r.setEnd(node, Math.min(12, node.nodeValue.length));
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  document.dispatchEvent(new Event("selectionchange"));
  return { selected: s.toString() };
});
await page.waitForTimeout(400);
const menuShown = await page.evaluate(() => {
  const menus = Array.from(document.querySelectorAll("div.fixed.z-50"));
  // 色块按钮 aria-label 现为「划线·青瓷」等（旧断言"高亮"已过期）
  return menus.some((m) => m.querySelector('button[aria-label^="划线"]'));
});

await page.screenshot({ path: ".e2e/reader-md.png" });
console.log("正文 markdown 元素统计:", JSON.stringify(md.tags));
console.log("正文是否仍残留生 markdown 符号(##/**):", md.rawLeak ? "❌ 是(渲染失败)" : "✅ 否(已渲染)");
console.log("正文开头:", JSON.stringify(md.sample));
console.log("模拟选中文字:", JSON.stringify(sel.selected), "→ 划线菜单:", menuShown ? "✅ 弹出(locate 命中)" : "❌ 未弹出");
const pass = md.ok && !md.rawLeak && (md.tags.h2 || md.tags.h3 || md.tags.strong || md.tags.li) && menuShown;
console.log(pass ? "\n✅ markdown 渲染 + 划线选区 均正常" : "\n⚠️ 有项未通过，见上");
await browser.close();
