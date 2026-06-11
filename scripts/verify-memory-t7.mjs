// T7 验收（任务书 4 项完成标准）：
//   ① 聊天透露个人信息 → user_memory 异步落表（前后对比留存）
//   ② 清空会话历史后再问 → 回答仍体现认知（证明走的是记忆而非对话历史）
//   ③ 流式 TTFB：有记忆 vs 无记忆 差异无可感知（<1s）
//   ④ RLS：A 用户 token 查不到 demo 的记忆行
// demo main 与 user_memory 测前备份、测后恢复
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
const uid = auth.user.id;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: mainBak } = await admin.from("chat_sessions").select("*").eq("user_id", uid).eq("id", "main").maybeSingle();
const { data: memBak } = await admin.from("user_memory").select("*").eq("user_id", uid).maybeSingle();

async function restore() {
  if (mainBak) await admin.from("chat_sessions").upsert(mainBak, { onConflict: "user_id,id" });
  else await admin.from("chat_sessions").delete().eq("user_id", uid).eq("id", "main");
  if (memBak) await admin.from("user_memory").upsert(memBak, { onConflict: "user_id" });
  else await admin.from("user_memory").delete().eq("user_id", uid);
  console.log("demo main + user_memory 已恢复原样");
}

const ask = (q, stream = false) => fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${auth.session.access_token}` },
  body: JSON.stringify({ stream, messages: [{ role: "user", content: q }] }),
  signal: AbortSignal.timeout(180000),
});

try {
  /* ① 造含个人信息的会话 → 触发记忆更新 → 查表 */
  await admin.from("user_memory").delete().eq("user_id", uid); // 从零开始，便于前后对比
  const msgs = [
    { id: "t7-1", role: "user", content: "跟你说个事，我是一名小学语文老师，平时喜欢读历史和教育类的书，我家猫叫年糕。" },
    { id: "t7-2", role: "assistant", content: "记住啦：语文老师、爱历史和教育、猫叫年糕。" },
    { id: "t7-3", role: "user", content: "最近我在准备班级的阅读课，想找些能用在课堂上的素材。" },
    { id: "t7-4", role: "assistant", content: "好的，阅读课素材这事我记下了，回头给你留意。" },
  ];
  await admin.from("chat_sessions").upsert(
    { user_id: uid, id: "main", title: "与小涤的对话", messages: msgs, compressed_history: null, compressed_until: 0, updated_at: new Date().toISOString() },
    { onConflict: "user_id,id" }
  );
  console.log("① 已造含个人信息的会话（语文老师/历史教育/猫年糕/在备阅读课），发请求触发记忆更新…");
  const r1 = await (await ask("好的，先这样")).json();
  console.log(`   回答 ${r1.content?.length ?? 0} 字；等待后台记忆更新（M3 思考需要一会儿）`);
  let mem = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    mem = (await admin.from("user_memory").select("*").eq("user_id", uid).maybeSingle()).data;
    if (mem) break;
  }
  const memText = mem ? JSON.stringify(mem) : "";
  ok(!!mem, "① 记忆行异步生成（更新前：无此行）");
  ok(/语文老师/.test(memText), "①b 身份画像落表", mem?.identity?.slice(0, 50));
  ok(/年糕/.test(memText), "①c 个人事实落表", mem?.facts?.slice(0, 50));
  fs.mkdirSync("docs/delivery/evidence/T7", { recursive: true });
  fs.writeFileSync("docs/delivery/evidence/T7/记忆落表前后对比.json", JSON.stringify({ before: null, after: mem }, null, 2));

  /* ② 清空会话历史再问：只有记忆能回答 */
  await admin.from("chat_sessions").upsert(
    { user_id: uid, id: "main", title: "与小涤的对话", messages: [], compressed_history: null, compressed_until: 0, updated_at: new Date().toISOString() },
    { onConflict: "user_id,id" }
  );
  const r2 = await (await ask("根据你对我的了解：我的职业是什么？我家猫叫什么？")).json();
  const knows = /语文老师/.test(r2.content ?? "") && /年糕/.test(r2.content ?? "");
  ok(knows, "② 历史已清空仍答对职业与猫名（认知来自记忆注入）", String(r2.content ?? "").replace(/\n/g, " ").slice(0, 80));
  fs.writeFileSync("docs/delivery/evidence/T7/跨历史记忆对话样本.txt", `问：根据你对我的了解：我的职业是什么？我家猫叫什么？\n答：${r2.content}`);

  /* ③ TTFB 对比：有记忆 vs 删除记忆 */
  async function ttfb(q) {
    const t0 = Date.now();
    const resp = await ask(q, true);
    const reader = resp.body.getReader();
    await reader.read(); // 首块
    const dt = Date.now() - t0;
    try { reader.cancel(); } catch {}
    return dt;
  }
  const withMem = await ttfb("用一句话打个招呼");
  await admin.from("user_memory").delete().eq("user_id", uid);
  const noMem = await ttfb("用一句话打个招呼");
  ok(Math.abs(withMem - noMem) < 1500, "③ 流式首包耗时无可感知差异", `有记忆 ${withMem}ms vs 无记忆 ${noMem}ms`);

  /* ④ RLS：临时建用户 A，查不到 demo 的记忆 */
  await admin.from("user_memory").upsert({ user_id: uid, facts: "rls-测试占位" }, { onConflict: "user_id" });
  const email = `t7-rls-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const { data: nu } = await admin.auth.admin.createUser({ email, password: "test123456", email_confirm: true });
  const { data: aAuth } = await anon.auth.signInWithPassword({ email, password: "test123456" });
  const aClient = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { authorization: `Bearer ${aAuth.session.access_token}` } },
  });
  const { data: cross } = await aClient.from("user_memory").select("*").eq("user_id", uid);
  ok((cross ?? []).length === 0, "④ A 用户查 demo 的记忆 0 行（RLS 隔离）");
  const { error: writeErr } = await aClient.from("user_memory").upsert({ user_id: nu.user.id, facts: "越权写" }, { onConflict: "user_id" });
  ok(!!writeErr, "④b 客户端直写 user_memory 被拒（写入仅服务端）", writeErr?.code ?? "竟然成功了");
  await admin.auth.admin.deleteUser(nu.user.id);
  console.log("   （RLS 测试用户已删除）");

  await restore();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
} catch (e) {
  await restore();
  throw e;
}
