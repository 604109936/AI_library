// T1 证据：数据库安全收紧后的攻击路径实测
// ① anon 伪造他人 uid 写 search_logs 被拒 ② anon 调维护函数被拒 ③ 登录用户直改 read_seconds 被拒
// ④ 登录用户改 nickname 正常 ⑤ anon 写 favorites 被拒 ⑥ 注册 metadata 昵称落 profiles（注册→查→删全程自清理）
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
// anon 必须全程保持匿名：绝不在这个实例上 signInWithPassword，否则后续"匿名攻击"断言会变成"登录本人操作"假成功
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

// ① 伪造他人 uid 写 search_logs
const { data: users } = await admin.auth.admin.listUsers();
const demoUid = users.users.find((u) => u.email === "demo@ailibrary.app")?.id;
{
  const { error } = await anon.from("search_logs").insert({ term: "t1-验证-伪造", user_id: demoUid });
  ok(!!error, "① anon 伪造他人 uid 写 search_logs 被拒", error?.code ?? "竟然成功了");
}
// ①b 匿名（user_id null）仍可写（产品口径）
{
  const { error } = await anon.from("search_logs").insert({ term: "t1-验证-匿名", user_id: null });
  ok(!error, "①b 游客匿名搜索上报仍正常", error?.message ?? "");
  await admin.from("search_logs").delete().eq("term", "t1-验证-匿名");
}
// ② anon 调维护函数
{
  const { error } = await anon.rpc("refresh_books_readers");
  ok(!!error, "② anon 调 refresh_books_readers 被拒", error?.code ?? "竟然成功了");
}
// ③④ 登录 demo：直改 read_seconds 被拒 / 改 nickname 正常（登录用独立客户端，不污染 anon）
const loginClient = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth } = await loginClient.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
const user = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { authorization: `Bearer ${auth.session.access_token}` } },
});
{
  const { error } = await user.from("profiles").update({ read_seconds: 999999 }).eq("id", auth.user.id).select();
  ok(!!error, "③ 登录用户直改 read_seconds 被拒（只能走只增 RPC）", error?.code ?? "竟然成功了");
}
{
  const { data: before } = await admin.from("profiles").select("nickname").eq("id", auth.user.id).single();
  const { error } = await user.from("profiles").update({ nickname: before.nickname }).eq("id", auth.user.id);
  ok(!error, "④ 登录用户改 nickname 正常（列级授权放行）", error?.message ?? "");
}
// ⑤ anon 写 favorites
{
  const { error } = await anon.from("favorites").insert({ user_id: demoUid, book_id: "b1" });
  ok(!!error, "⑤ anon 写 favorites 被拒（表级写权限已收）", error?.code ?? "竟然成功了");
}
// ⑥ 注册 metadata 昵称 → handle_new_user 落 profiles（用后即删）
{
  const email = `t1-verify-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const { data: nu, error: cErr } = await admin.auth.admin.createUser({
    email, password: "test123456", email_confirm: true,
    user_metadata: { nickname: "收紧验证员" },
  });
  if (cErr) ok(false, "⑥ 创建测试用户失败", cErr.message);
  else {
    const { data: prof } = await admin.from("profiles").select("nickname").eq("id", nu.user.id).maybeSingle();
    ok(prof?.nickname === "收紧验证员", "⑥ 注册 metadata 昵称经触发器落 profiles", `实际=${prof?.nickname}`);
    await admin.auth.admin.deleteUser(nu.user.id);
    console.log("   （测试用户已删除）");
  }
}
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
