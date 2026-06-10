// 核查：现库每本书 ai_digest / 每章 ai_summary 覆盖情况（智学 Agent 数据前提，只读）
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
try {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const books = await sb.from("books").select("id, title, ai_digest");
const chaps = await sb.from("chapters").select("id, book_id, no, ai_summary");
if (books.error || chaps.error) { console.log("❌", books.error?.message ?? chaps.error?.message); process.exit(1); }

let missB = 0, missC = 0;
for (const b of books.data) {
  const bc = chaps.data.filter((c) => c.book_id === b.id);
  const noDigest = !b.ai_digest?.trim();
  const noSum = bc.filter((c) => !c.ai_summary?.trim());
  if (noDigest) missB++;
  missC += noSum.length;
  console.log(`${noDigest || noSum.length ? "⚠️" : "✅"} ${b.id}《${b.title}》 ai_digest=${noDigest ? "缺" : `${b.ai_digest.trim().length}字`} | 章 ${bc.length} 个，ai_summary 缺 ${noSum.length}${noSum.length ? `（第 ${noSum.map((c) => c.no).join("/")} 章）` : ""}`);
}
console.log(`\n汇总：${books.data.length} 本书（缺概要 ${missB}）/ ${chaps.data.length} 章（缺章概要 ${missC}）`);
console.log(missB + missC === 0 ? "✅ 数据前提齐备，T2.0 无需生成" : "⚠️ 有缺口，需补齐后智学才能发挥全部水平");
