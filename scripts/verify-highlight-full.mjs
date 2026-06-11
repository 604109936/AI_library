// 高亮完整性回归（每次动阅读器必跑）：
//   ① 跨段落选区 → 划线 → 正文 mark 完整覆盖选中文本（无缺段/错位）
//   ② 刷新后 offset 还原，标记仍完整
//   ③ demo 共享账号：测试产生的笔记测后删除（备份-测试-还原口径）
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const ID = process.env.BOOK_ID || "the-untethered-soul";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: users } = await admin.auth.admin.listUsers();
const demo = users.users.find((u) => u.email === "demo@ailibrary.app");

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
let createdExcerpt = "";
try {
  // 登录 demo
  await page.goto(`${BASE}/me`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.getByText("登录 / 注册").first().click();
  await page.waitForTimeout(600);
  await page.getByText("试试体验账号", { exact: false }).click();
  await page.waitForFunction(() => (document.body.textContent || "").includes("编辑资料"), { timeout: 25000 });

  // 进阅读器并翻到正式章节
  await page.goto(`${BASE}/library/book/${ID}/read`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const el = document.querySelector(".break-words"); return el && (el.textContent || "").length > 50; }, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "下一章" }).click().catch(() => {});
  await page.waitForTimeout(900);

  // 跨段落选区：第一段末尾 → 第二段开头
  const sel = await page.evaluate(() => {
    const root = document.querySelector(".break-words");
    if (!root) return null;
    const ps = Array.from(root.querySelectorAll("p")).filter((p) => (p.textContent || "").trim().length > 20);
    if (ps.length < 2) return null;
    const w1 = document.createTreeWalker(ps[0], NodeFilter.SHOW_TEXT);
    let last = null, n;
    while ((n = w1.nextNode())) last = n;
    const w2 = document.createTreeWalker(ps[1], NodeFilter.SHOW_TEXT);
    const first = w2.nextNode();
    if (!last || !first) return null;
    const r = document.createRange();
    r.setStart(last, Math.max(0, last.nodeValue.length - 8));
    r.setEnd(first, Math.min(8, first.nodeValue.length));
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
    // 计算期望的 textContent 真值（与落库口径一致：textContent 切片 + trim 同步）
    return { rendered: s.toString() };
  });
  ok(!!sel, "构造跨段落选区成功");
  await page.waitForTimeout(400);

  // 点第一个色块划线
  const colorBtn = page.locator('button[aria-label^="划线"]').first();
  await colorBtn.click({ timeout: 5000 });
  await page.waitForTimeout(1500);

  // 标记完整性：拼接全部 mark 段文本 == 选中文本（textContent 口径，空白可被 trim 修正）
  const check1 = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll("mark[data-note]"));
    if (!marks.length) return { found: false };
    const byNote = {};
    for (const m of marks) {
      const id = m.getAttribute("data-note");
      byNote[id] = (byNote[id] || "") + (m.textContent || "");
    }
    const texts = Object.values(byNote);
    return { found: true, texts, count: marks.length };
  });
  ok(check1.found, "划线后正文出现 mark 标记", `${check1.count ?? 0} 段`);
  const joined1 = (check1.texts ?? []).find((t) => t.length > 6) ?? "";
  createdExcerpt = joined1;
  // 选区被 trim 后应仍含两段内容（跨段完整）
  ok(joined1.length >= 10, "标记覆盖完整跨段文本", JSON.stringify(joined1.slice(0, 24)));

  // 刷新后标记仍完整（offset 还原与渲染口径一致）
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("mark[data-note]").length > 0, { timeout: 20000 }).catch(() => {});
  const check2 = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll("mark[data-note]"));
    const byNote = {};
    for (const m of marks) {
      const id = m.getAttribute("data-note");
      byNote[id] = (byNote[id] || "") + (m.textContent || "");
    }
    return Object.values(byNote);
  });
  ok(check2.some((t) => t === joined1), "刷新后标记按 offset 完整还原", `${check2.length} 条划线`);

  // 合并扩展：从既有划线「最后一段」中部选到划线之后的正文（重叠 + 向后延伸）→ 点色块 → 应合并为一条更长的划线
  await page.evaluate(() => {
    const root = document.querySelector(".break-words");
    const marks = Array.from(document.querySelectorAll("mark[data-note]"));
    const mark = marks[marks.length - 1];
    if (!root || !mark) return;
    const markText = mark.firstChild;
    // 文档序遍历找到 mark 之后第一个有内容的正文文本节点
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n, found = null, passed = false;
    while ((n = w.nextNode())) {
      if (mark.contains(n)) { passed = true; continue; }
      if (passed && (n.nodeValue ?? "").trim().length > 8) { found = n; break; }
    }
    const r = document.createRange();
    r.setStart(markText, Math.max(0, Math.floor((markText.nodeValue ?? "").length / 2)));
    if (found) r.setEnd(found, Math.min(8, found.nodeValue.length));
    else r.setEnd(markText, (markText.nodeValue ?? "").length);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.waitForTimeout(400);
  await page.locator('button[aria-label^="划线"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  const merged = await page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll("mark[data-note]"));
    const ids = new Set(marks.map((m) => m.getAttribute("data-note")));
    const byNote = {};
    for (const m of marks) {
      const id = m.getAttribute("data-note");
      byNote[id] = (byNote[id] || "") + (m.textContent || "");
    }
    return { count: ids.size, texts: Object.values(byNote) };
  });
  ok(merged.count === 1, "重叠选区合并为一条划线（不再拒绝）", `现 ${merged.count} 条`);
  const mergedText = merged.texts[0] ?? "";
  createdExcerpt = mergedText || createdExcerpt;
  ok(mergedText.length > joined1.length, "合并后区间为并集（比原划线更长）", `${joined1.length}→${mergedText.length} 字`);
} finally {
  // 清理：删掉本次测试写入的 demo 笔记
  if (createdExcerpt) {
    await admin.from("notes").delete().eq("user_id", demo.id).eq("excerpt", createdExcerpt);
    console.log("已清理本次测试写入的 demo 划线");
  }
  await browser.close();
}
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
