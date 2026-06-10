// 查 chat_sessions 的 RLS 策略与直插测试（定位 T2.5 落库失败根因）
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;

// ① 用 anon+登录态直接试 upsert（看真实报错）
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error: e1 } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
if (e1) { console.log("登录失败:", e1.message); process.exit(1); }
const r = await anon.from("chat_sessions").upsert(
  { user_id: auth.user.id, id: "probe-" + auth.user.id.slice(0, 6), title: "探针", messages: [{ id: "m1", role: "user", content: "hi" }], updated_at: new Date().toISOString() },
  { onConflict: "user_id,id" }
);
console.log("① 登录态直插 chat_sessions:", r.error ? `❌ ${r.error.code} ${r.error.message}` : "✅ 成功");

// ② 清理探针 + 列出该表已建策略（service_role 查询）
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
await admin.from("chat_sessions").delete().eq("id", "probe-" + auth.user.id.slice(0, 6));
const pol = await admin.rpc("exec_sql", { q: "select policyname from pg_policies where tablename='chat_sessions'" }).then(
  (x) => x,
  () => null
);
console.log("② pg_policies 查询:", pol?.data ? JSON.stringify(pol.data) : "（无 exec_sql RPC，跳过，仅以①为准）");
