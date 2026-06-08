// 回读数据库统计：分类/书/章节条数 + 每本书概览（用公开 anon key，验证 RLS 公开读）。
// 运行：node --env-file=.env.local scripts/db-stats.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, anon);

const { count: catN } = await supabase.from("categories").select("*", { count: "exact", head: true });
const { count: bookN } = await supabase.from("books").select("*", { count: "exact", head: true });
const { count: chapN } = await supabase.from("chapters").select("*", { count: "exact", head: true });

console.log(`\n=== 数据库现状 ===`);
console.log(`分类 categories: ${catN}`);
console.log(`书   books:      ${bookN}`);
console.log(`章节 chapters:   ${chapN}\n`);

const { data: books, error } = await supabase
  .from("books")
  .select("id,title,author,category_id,words,has_video,has_audio,has_text,featured,shelved_at,ai_digest")
  .order("shelved_at", { ascending: false });
if (error) { console.error("读 books 失败：", error.message); process.exit(1); }

for (const b of books) {
  const { count: cn } = await supabase.from("chapters").select("*", { count: "exact", head: true }).eq("book_id", b.id);
  const modes = [b.has_video && "视频", b.has_audio && "音频", b.has_text && "文字稿"].filter(Boolean).join("+");
  console.log(`《${b.title}》/${b.author}  [${b.category_id}] ${b.words}字 ${modes} 章节${cn} ai_digest:${b.ai_digest ? "✓" : "✗"} 入库:${b.shelved_at?.slice(0, 19)}`);
}
console.log("");
