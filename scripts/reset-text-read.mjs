// 清理「章节已读」误标脏数据（bug e191ba2 修复后的口径重置）。
// 安全设计：默认只读盘点（dry-run）；--apply 时也只对盘点列出的明确 user_id 逐一清理，绝不全表盲扫。
//   盘点：node --env-file=.env.local scripts/reset-text-read.mjs
//   执行：node --env-file=.env.local scripts/reset-text-read.mjs --apply
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// 自行加载 .env.local（不依赖 --env-file 启动参数）
try {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.log("❌ 缺少环境变量（.env.local 未找到）"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");

// ① 盘点现状（只读）
const tp = await sb.from("text_progress").select("user_id, book_id, pct, read_chapter_ids, updated_at");
const rh = await sb.from("reading_history").select("user_id, book_id, mode_category, progress, last_at").eq("mode_category", "text");
if (tp.error || rh.error) { console.log("❌ 读取失败:", tp.error?.message ?? rh.error?.message); process.exit(1); }

console.log(`text_progress 共 ${tp.data.length} 行：`);
for (const r of tp.data) console.log(`  user=${r.user_id.slice(0, 8)}… book=${r.book_id} pct=${r.pct} 已读章=${(r.read_chapter_ids ?? []).length} 个`);
console.log(`reading_history(text) 共 ${rh.data.length} 行：`);
for (const r of rh.data) console.log(`  user=${r.user_id.slice(0, 8)}… book=${r.book_id} progress=${r.progress}`);

const users = [...new Set([...tp.data, ...rh.data].map((r) => r.user_id))];
console.log(`涉及用户 ${users.length} 个`);
if (!APPLY) { console.log("\n（dry-run 结束，未做任何修改；加 --apply 才执行清理）"); process.exit(0); }

// ② 按盘点出的 user_id 逐一精准清理
for (const uid of users) {
  const a = await sb.from("text_progress").update({ read_chapter_ids: [], pct: 0 }).eq("user_id", uid).select("book_id");
  if (a.error) { console.log(`❌ user=${uid.slice(0, 8)}… text_progress 失败:`, a.error.message); process.exit(1); }
  const b = await sb.from("reading_history").update({ progress: 0 }).eq("user_id", uid).eq("mode_category", "text").select("book_id");
  if (b.error) { console.log(`❌ user=${uid.slice(0, 8)}… reading_history 失败:`, b.error.message); process.exit(1); }
  console.log(`✅ user=${uid.slice(0, 8)}… 清理完成（text_progress ${a.data.length} 行 / history ${b.data.length} 行）`);
}

// ③ 回读核验
const v = await sb.from("text_progress").select("user_id, book_id, pct, read_chapter_ids");
const bad = (v.data ?? []).filter((r) => r.pct !== 0 || (r.read_chapter_ids ?? []).length > 0);
console.log(bad.length === 0 ? "✅ 核验通过：已读章全部清空、进度全部归零" : `❌ 仍有 ${bad.length} 行未清干净`);
