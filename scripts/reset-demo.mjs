// 一次性：清空体验账号(demo)的全部用户数据（收藏/笔记/书评/历史/进度），恢复干净。
// 用于清除之前测试/中断 e2e 残留。运行：node --env-file=.env.local scripts/reset-demo.mjs
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: list } = await admin.auth.admin.listUsers();
const demo = (list?.users ?? []).find((u) => u.email === "demo@ailibrary.app");
if (!demo) { console.log("没找到体验账号"); process.exit(0); }

for (const t of ["favorites", "notes", "reviews", "review_likes", "reading_history", "text_progress", "media_progress"]) {
  const { error } = await admin.from(t).delete().eq("user_id", demo.id);
  console.log(`${error ? "❌" : "✓"} 清 ${t}${error ? " " + error.message : ""}`);
}
await admin.from("profiles").update({ read_seconds: 0 }).eq("id", demo.id);
console.log("✓ 体验账号已恢复干净（重新登录即可看到空的收藏/笔记/历史/进度）");
