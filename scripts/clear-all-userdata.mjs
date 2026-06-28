// 清空「所有用户」的业务数据（保留账号本身 + 馆藏 books/chapters/categories），用于干净验收。
// 清：favorites/notes/reviews/review_likes/reading_history/text_progress/media_progress/
//     chat_sessions/user_memory/feedback/search_logs/flip_feed，并把 profiles.read_seconds 归零。
// 默认不动 books.read_count（馆藏聚合·阅读次数）；加 --read-count 一并归零。
// 运行：node --env-file=.env.local scripts/clear-all-userdata.mjs [--read-count]
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const alsoReadCount = process.argv.includes("--read-count");

// 这些表都有 user_id：用 not-null 命中所有有主行；search_logs 额外清游客(user_id 为 null)行。
const TABLES = [
  "favorites", "notes", "reviews", "review_likes", "reading_history",
  "text_progress", "media_progress", "chat_sessions", "user_memory",
  "feedback", "search_logs", "flip_feed",
];

let ok = 0, fail = 0;
for (const t of TABLES) {
  const { count } = await admin.from(t).select("*", { count: "exact", head: true });
  const { error } = await admin.from(t).delete().not("user_id", "is", null);
  // search_logs 允许 user_id 为 null（游客搜索）：再清一遍 null 行
  if (!error && t === "search_logs") await admin.from(t).delete().is("user_id", null);
  if (error) { fail++; console.log(`❌ ${t}：${error.message}`); }
  else { ok++; console.log(`✓ 清空 ${t}（原约 ${count ?? "?"} 行）`); }
}

// 阅读总时长归零（保留昵称/头像/简介等账号资料）
const { error: pe } = await admin.from("profiles").update({ read_seconds: 0 }).not("id", "is", null);
console.log(pe ? `❌ profiles.read_seconds 归零失败：${pe.message}` : "✓ profiles.read_seconds 全部归零");

if (alsoReadCount) {
  const { error: re } = await admin.from("books").update({ read_count: 0 }).not("id", "is", null);
  console.log(re ? `❌ books.read_count 归零失败：${re.message}` : "✓ books.read_count 全部归零");
}

console.log(`\n完成：${ok} 张表清空、${fail} 张失败。账号与馆藏均保留，重新登录即是干净状态。`);
