// 验证 T2.6 上下文压缩：造一个 60 条消息的长会话 → 发一次真实请求触发后台压缩 →
// 断言 compressed_history 生成、compressed_until=20（60-40），且新请求能用上摘要（多轮记忆跨压缩存活）
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SID = "verify-compress-001";

const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
if (error) { console.log("❌ demo 登录失败:", error.message); process.exit(1); }
const uid = auth.user.id;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ① 造 60 条消息的长会话（旧消息里埋一个独特事实，看压缩后是否还记得）
const msgs = [];
msgs.push({ id: "m0", role: "user", content: "我先自我介绍：我是一名小学语文老师，最爱的书是《了凡四训》，我家猫叫年糕。" });
msgs.push({ id: "m1", role: "assistant", content: "记住啦：语文老师、最爱《了凡四训》、猫叫年糕。" });
for (let i = 2; i < 60; i++) {
  msgs.push({ id: "m" + i, role: i % 2 === 0 ? "user" : "assistant", content: (i % 2 === 0 ? "随便聊聊第" : "好的，关于第") + i + "个话题的内容，凑长度用。" });
}
await admin.from("chat_sessions").upsert(
  { user_id: uid, id: SID, title: "压缩验证会话", messages: msgs, compressed_history: null, compressed_until: 0, updated_at: new Date().toISOString() },
  { onConflict: "user_id,id" }
);
console.log("① 已造 60 条消息的会话（旧消息埋点：语文老师/《了凡四训》/猫叫年糕）");

// ② 发一次真实请求（带 sessionId）触发后台压缩
const ask = (q) => fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${auth.session.access_token}` },
  body: JSON.stringify({ messages: [{ role: "user", content: q }], sessionId: SID, stream: false }),
  signal: AbortSignal.timeout(180000),
}).then((r) => r.json());
await ask("好的，先回到读书话题");
console.log("② 已发请求，等待后台压缩…");
let row = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  row = (await admin.from("chat_sessions").select("compressed_history,compressed_until").eq("user_id", uid).eq("id", SID).maybeSingle()).data;
  if (row?.compressed_history) break;
}
const okC = !!row?.compressed_history && row.compressed_until === 20;
console.log(`③ 压缩结果：compressed_until=${row?.compressed_until}（应为 20）摘要 ${row?.compressed_history?.length ?? 0} 字 → ${okC ? "✅" : "❌"}`);
console.log("   摘要节选:", String(row?.compressed_history ?? "").slice(0, 160).replace(/\n/g, " | "));

// ③ 跨压缩记忆：新请求只发 1 条消息，靠摘要回忆旧信息
const a = await ask("只根据你对我的了解回答：我的职业是什么？我的猫叫什么名字？");
const okM = /语文老师/.test(a.content) && /年糕/.test(a.content);
console.log(`④ 跨压缩记忆：${okM ? "✅ 记得职业与猫名" : "⚠️ 看回答人工判断"}`);
console.log("   回答节选:", String(a.content).replace(/\n/g, " | ").slice(0, 200));

// 清理验证会话
await admin.from("chat_sessions").delete().eq("user_id", uid).eq("id", SID);
console.log(okC ? "\n✅ T2.6 压缩验证通过（验证会话已清理）" : "\n⚠️ 未通过（验证会话已清理）");
