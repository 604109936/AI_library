// 复现「新注册账号下写笔记」：anon signUp(确认已关→直接拿会话) → 立刻插 notes → 报错则打印。
// 运行：node --env-file=.env.local scripts/test-note-newuser.mjs
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, anon, { auth: { persistSession: false } });

const email = `notetest_${Date.now()}@example.com`;
const { data: su, error: se } = await sb.auth.signUp({ email, password: "test123456" });
if (se) { console.error("注册失败:", se.message); process.exit(1); }
if (!su.session) { console.error("⚠️ 注册无会话（邮箱验证可能未关）→ 这正是会导致写库失败的原因！"); }
console.log(`注册新用户 ${email}，会话: ${su.session ? "有" : "无"}，uid=${su.user?.id?.slice(0,8)}…`);

const { error: ne } = await sb.from("notes").insert({
  id: randomUUID(), user_id: su.user.id, book_id: "the-untethered-soul",
  chapter_id: "the-untethered-soul-c1", excerpt: "脑海中的声音", note: "新用户测试笔记",
  color: "#8FB39B", start_offset: 12, end_offset: 18,
});
console.log(ne ? `❌ 新用户写笔记失败：code=${ne.code} msg=${ne.message}` : "✓ 新用户写笔记成功");

// 清理：删该测试用户（service_role）
try {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await admin.from("notes").delete().eq("user_id", su.user.id);
  await admin.auth.admin.deleteUser(su.user.id);
  console.log("（已删除测试用户）");
} catch (e) { console.log("清理告警:", e.message); }
