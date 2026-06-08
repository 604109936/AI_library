// 书库导入脚本。两种写入模式 + 干跑校验。
//   模式（默认「非覆盖」）：
//     非覆盖：库中已存在的 book_id 直接跳过，不动已有数据（保护现有）。
//     覆盖：  加 --overwrite，已存在的书会被更新（其章节先删后插，保证章节集合一致）。
//   用法：
//     干跑校验（非覆盖预览，默认）：node --env-file=.env.local scripts/import-books.mjs
//     干跑校验（覆盖预览）：        node --env-file=.env.local scripts/import-books.mjs --overwrite
//     真正导入（非覆盖，默认）：    node --env-file=.env.local scripts/import-books.mjs --commit
//     真正导入（覆盖）：            node --env-file=.env.local scripts/import-books.mjs --commit --overwrite
//     指定文件：命令末尾加路径，如 ... --commit data/books.json
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const OVERWRITE = process.argv.includes("--overwrite");
const MODE = OVERWRITE ? "覆盖（已存在则更新）" : "非覆盖（已存在则跳过）";
const FILE = process.argv.find((a) => a.endsWith(".json")) || "data/books.json";

const CATEGORIES = [
  { id: "psy", name: "心学", icon: "Brain", sort_order: 1 },
  { id: "growth", name: "成长", icon: "Sprout", sort_order: 2 },
  { id: "tech", name: "科技", icon: "Cpu", sort_order: 3 },
  { id: "biz", name: "商业", icon: "TrendingUp", sort_order: 4 },
  { id: "lit", name: "文学", icon: "Feather", sort_order: 5 },
  { id: "his", name: "历史", icon: "Landmark", sort_order: 6 },
];
const CAT_IDS = new Set(CATEGORIES.map((c) => c.id));
const CAT_NAMES = new Set(CATEGORIES.map((c) => c.name));

// ---------- 读取 + 解析 ----------
let data;
try {
  data = JSON.parse(readFileSync(FILE, "utf8"));
} catch (e) {
  console.error(`❌ 读取/解析 ${FILE} 失败（JSON 语法错误？）：\n   ${e.message}`);
  process.exit(1);
}
if (!data || !Array.isArray(data.books)) {
  console.error('❌ 顶层结构应为 { "books": [ ... ] }');
  process.exit(1);
}
const books = data.books;

// ---------- 校验 ----------
const errors = [];
const warnings = [];
const seenIds = new Set();
for (let i = 0; i < books.length; i++) {
  const b = books[i];
  const where = `books[${i}]${b?.id ? ` (${b.id})` : ""}`;
  for (const f of ["id", "title", "author", "category_id", "summary", "intro"]) {
    if (typeof b[f] !== "string" || !b[f].trim()) errors.push(`${where}: 缺少必填字段 ${f}`);
  }
  if (b.id) {
    if (seenIds.has(b.id)) errors.push(`${where}: id 重复`);
    seenIds.add(b.id);
    if (!/^[a-z0-9-]+$/.test(b.id)) warnings.push(`${where}: id 建议用小写英文/数字/连字符`);
  }
  if (b.category_id && !CAT_IDS.has(b.category_id))
    errors.push(`${where}: category_id "${b.category_id}" 不是 6 个合法值之一（psy/growth/tech/biz/lit/his）`);
  if (b.tags != null) {
    if (!Array.isArray(b.tags)) errors.push(`${where}: tags 必须是字符串数组`);
    else if (b.tags.some((t) => CAT_NAMES.has(t)))
      warnings.push(`${where}: tags 里含分类名，建议去掉（前端会自动把分类名置顶）`);
  }
  if (b.words != null && typeof b.words !== "number") errors.push(`${where}: words 必须是数字（不要加引号）`);
  if (!b.ai_digest || !String(b.ai_digest).trim())
    warnings.push(`${where}: 缺 ai_digest（智学 Agent 推荐/答疑质量会下降）`);

  if (!Array.isArray(b.chapters) || b.chapters.length === 0) {
    errors.push(`${where}: 缺 chapters（至少 1 章）`);
  } else {
    const firstNo = b.chapters[0]?.no; // 0=含前言；1=无前言
    if (firstNo !== 0 && firstNo !== 1) errors.push(`${where}: 首章 no 应为 0(前言) 或 1，实际 ${firstNo}`);
    b.chapters.forEach((c, ci) => {
      const cw = `${where} 章[${ci}]`;
      const expected = (firstNo ?? 1) + ci;
      if (c.no !== expected) errors.push(`${cw}: no 应为 ${expected}（从首章连续递增），实际 ${c.no}`);
      if (c.no === 0 && c.title !== "前言") warnings.push(`${cw}: no:0 约定标题为「前言」，实际「${c.title}」`);
      if (typeof c.title !== "string" || !c.title.trim()) errors.push(`${cw}: 缺 title`);
      if (typeof c.content !== "string" || !c.content.trim())
        warnings.push(`${cw}: content 为空（该书将不被视为"有文字稿"）`);
      if (!c.ai_summary || !String(c.ai_summary).trim()) warnings.push(`${cw}: 缺 ai_summary（智学 Agent 用）`);
    });
  }
}

// ---------- 报告：每本概览 ----------
console.log(`\n================  书库校验报告（${FILE}）================`);
console.log(`共 ${books.length} 本书 | 写入模式：${MODE}\n`);
for (let i = 0; i < books.length; i++) {
  const b = books[i];
  const cat = CATEGORIES.find((c) => c.id === b.category_id);
  const modes =
    [b.video_url && "视频", b.audio_url && "音频", b.chapters?.some((c) => c.content?.trim()) && "文字稿"]
      .filter(Boolean)
      .join("+") || "（无）";
  console.log(`  ${i + 1}. 《${b.title}》 / ${b.author}`);
  console.log(`     分类: ${cat ? cat.name : "❌" + b.category_id} | 章节: ${b.chapters?.length ?? 0} | 字数: ${b.words ?? "-"} | 形态: ${modes}`);
  console.log(`     ai_digest: ${b.ai_digest ? "✓" : "✗"} | 各章 ai_summary: ${b.chapters?.every((c) => c.ai_summary) ? "全有" : "有缺"} | 封面: ${b.cover_url ? "✓" : "✗"}`);
}

console.log(`\n--- 校验结果 ---`);
if (warnings.length) {
  console.log(`⚠️  提示 ${warnings.length} 条（不阻断）：`);
  warnings.forEach((w) => console.log(`   - ${w}`));
}
if (errors.length) {
  console.log(`\n❌ 错误 ${errors.length} 条（必须修复才能导入）：`);
  errors.forEach((e) => console.log(`   - ${e}`));
  console.log(`\n请修复后重跑。未写入任何数据。`);
  process.exit(1);
}
console.log(`✅ 无阻断性错误，数据合法。`);

// ---------- 查询库中已有 book_id（用于跳过/更新预判，公开读 anon 即可） ----------
let existingIds = new Set();
let dbReady = false;
{
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anon && !String(anon).includes("请粘贴")) {
    const reader = createClient(url, anon, { auth: { persistSession: false } });
    const { data: rows, error } = await reader.from("books").select("id");
    if (!error) {
      existingIds = new Set((rows ?? []).map((r) => r.id));
      dbReady = true;
    }
  }
}
const willSkip = books.filter((b) => existingIds.has(b.id));
const willNew = books.filter((b) => !existingIds.has(b.id));

console.log(`\n--- 导入计划（模式：${MODE}）---`);
if (dbReady) {
  console.log(`库中已有 ${existingIds.size} 本。`);
  if (OVERWRITE) {
    console.log(`本次将：导入 ${willNew.length} 本新书 + 更新 ${willSkip.length} 本已存在。`);
    if (willSkip.length) console.log(`   更新(已存在): ${willSkip.map((b) => b.id).join(", ")}`);
  } else {
    console.log(`本次将：导入 ${willNew.length} 本新书，跳过 ${willSkip.length} 本已存在。`);
    if (willSkip.length) console.log(`   跳过(已存在): ${willSkip.map((b) => b.id).join(", ")}`);
  }
} else {
  console.log(`（未连库预判；导入时仍会按"${MODE}"在数据库层执行。）`);
}

if (!COMMIT) {
  console.log(`\n这是【干跑校验】，未写入数据库。`);
  console.log(`确认后真正导入：node --env-file=.env.local scripts/import-books.mjs --commit${OVERWRITE ? " --overwrite" : ""}\n`);
  process.exit(0);
}

// ---------- 真正导入 ----------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret || String(secret).includes("请粘贴")) {
  console.error("❌ 缺少 SUPABASE_SERVICE_ROLE_KEY，无法写库。确认 .env.local 已填 Secret key，且命令带了 --env-file=.env.local");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { persistSession: false } });

console.log(`\n--- 开始导入（${MODE}）---`);
// 1) 分类（始终确保 6 个存在）
{
  const { error } = await admin.from("categories").upsert(CATEGORIES, { onConflict: "id" });
  if (error) { console.error("❌ 分类导入失败：", error.message); process.exit(1); }
  console.log(`✓ 分类 6 个`);
}
// 2) 书 + 章节（按数组顺序逐本插入 → 新书 shelved_at 默认 now() 递增 → 数组靠后=更新）
let nNew = 0, nUpd = 0, nSkip = 0;
for (let i = 0; i < books.length; i++) {
  const b = books[i];
  const isExisting = dbReady && existingIds.has(b.id);
  if (isExisting && !OVERWRITE) { nSkip++; console.log(`· 跳过《${b.title}》（已存在）`); continue; }

  const bookRow = {
    id: b.id,
    title: b.title,
    author: b.author,
    category_id: b.category_id,
    cover_url: b.cover_url ?? null,
    cover_seed: i + 1,
    tags: Array.isArray(b.tags) ? b.tags : [],
    summary: b.summary,
    intro: b.intro,
    words: typeof b.words === "number" ? b.words : 0,
    duration_min: typeof b.words === "number" ? Math.round(b.words / 550) : 0,
    has_video: !!b.video_url,
    has_audio: !!b.audio_url,
    has_text: b.chapters.some((c) => c.content?.trim()),
    video_url: b.video_url ?? null,
    audio_url: b.audio_url ?? null,
    featured: !!b.featured,
    ai_digest: b.ai_digest ?? null,
    // shelved_at / created_at 不传 → 新行用 DB 默认 now()；更新时不动（保留原入库时间）。计数列不传 → 默认 0。
  };
  const { error: be } = await admin.from("books").upsert(bookRow, { onConflict: "id", ignoreDuplicates: !OVERWRITE });
  if (be) { console.error(`❌ 《${b.title}》导入失败：`, be.message); process.exit(1); }

  // 覆盖模式下，先删该书旧章节，保证章节集合与新数据一致（防止旧的多余章节残留）
  if (isExisting && OVERWRITE) {
    const { error: de } = await admin.from("chapters").delete().eq("book_id", b.id);
    if (de) { console.error(`❌ 《${b.title}》清旧章节失败：`, de.message); process.exit(1); }
  }
  const chapterRows = b.chapters.map((c) => ({
    id: `${b.id}-c${c.no}`,
    book_id: b.id,
    no: c.no,
    title: c.title,
    content: c.content ?? "",
    ai_summary: c.ai_summary ?? null,
    audio_start: typeof c.audio_start === "number" ? c.audio_start : 0,
  }));
  const { error: ce } = await admin.from("chapters").upsert(chapterRows, { onConflict: "id", ignoreDuplicates: !OVERWRITE && !isExisting ? false : !OVERWRITE });
  if (ce) { console.error(`❌ 《${b.title}》章节导入失败：`, ce.message); process.exit(1); }

  if (isExisting) { nUpd++; console.log(`✓ 更新《${b.title}》 + ${chapterRows.length} 章`); }
  else { nNew++; console.log(`✓ 新增《${b.title}》 + ${chapterRows.length} 章`); }
}

console.log(`\n✅ 导入完成（${MODE}）：新增 ${nNew} 本，更新 ${nUpd} 本，跳过 ${nSkip} 本。`);
