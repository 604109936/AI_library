// T5 验证：压缩放宽（约5K tokens产物）+ M3 压缩模型 + 新「请求口径」until 计数
//   造 72 条信息密度高的长会话（每条含独特事实，难以归并压缩）→ 触发真实压缩 →
//   断言：摘要远超旧 1500-token 上限（>2000 字）、until=32（请求口径 72-40）、跨压缩记忆存活
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SID = "main"; // T4 单一会话：服务端只认 main，压缩/历史都挂在它上面

const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
if (error) { console.log("❌ demo 登录失败:", error.message); process.exit(1); }
const uid = auth.user.id;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// demo 是共享体验账号：备份 main 原样，测后恢复
const { data: mainBackup } = await admin.from("chat_sessions").select("*").eq("user_id", uid).eq("id", "main").maybeSingle();

// ① 72 条高信息密度消息：每条带独特数字事实/书名/人名，模型没法"归并凑数"只能逐条保留要点
const topics = ["《了凡四训》的立命之学", "《认知觉醒》的舒适区边缘", "《被讨厌的勇气》课题分离", "《清醒地活》的觉察练习", "《人生只有一件事》的听话照做", "《你当像鸟飞往你的山》的原生家庭", "《格调》的生活品味分层"];
const msgs = [];
msgs.push({ id: "m0", role: "user", content: "我先自我介绍：我是一名小学语文老师，最爱的书是《了凡四训》，我家猫叫年糕。" });
msgs.push({ id: "m1", role: "assistant", content: "记住啦：语文老师、最爱《了凡四训》、猫叫年糕。" });
for (let i = 2; i < 72; i++) {
  const t = topics[i % topics.length];
  msgs.push({
    id: "m" + i,
    role: i % 2 === 0 ? "user" : "assistant",
    content:
      i % 2 === 0
        ? `关于${t}，我第 ${i} 天的实践记录：我在第 ${i} 页读到一个关键概念，做了 ${i} 分钟笔记，给学生设计了第 ${i} 号教案，把书里的方法用在班上第 ${i} 组的阅读课上，孩子们的专注时长提升到了 ${10 + (i % 20)} 分钟。我的疑问是这个方法对低年级是否同样适用？`
        : `第 ${i} 天的回应：${t}这部分的核心在于把抽象原则落到具体行为。针对你第 ${i} 号教案，我建议把练习拆成 ${(i % 4) + 2} 步，每步不超过 ${(i % 5) + 3} 分钟，并在第 ${i} 周复盘一次。低年级适用的关键是把文字任务换成口头复述。`,
  });
}
await admin.from("chat_sessions").upsert(
  { user_id: uid, id: SID, title: "压缩放宽验证", messages: msgs, compressed_history: null, compressed_until: 0, updated_at: new Date().toISOString() },
  { onConflict: "user_id,id" }
);
const srcChars = msgs.slice(0, 32).reduce((s, m) => s + m.content.length, 0);
console.log(`① 已造 72 条高密度会话（待压缩前 32 条共 ${srcChars} 字；埋点：语文老师/《了凡四训》/猫叫年糕）`);

// ② 触发真实压缩
const ask = (q) => fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${auth.session.access_token}` },
  body: JSON.stringify({ messages: [{ role: "user", content: q }], sessionId: SID, stream: false }),
  signal: AbortSignal.timeout(180000),
}).then((r) => r.json());
await ask("好的，先回到读书话题");
console.log("② 已发请求，等待后台压缩（M3 思考+长摘要可能要一两分钟）…");
let row = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  row = (await admin.from("chat_sessions").select("compressed_history,compressed_until").eq("user_id", uid).eq("id", SID).maybeSingle()).data;
  if (row?.compressed_history) break;
}
const len = row?.compressed_history?.length ?? 0;
const okU = row?.compressed_until === 32;
const okL = len > 2000; // 远超旧 1500-token(≈1000字) 上限即证明放宽生效；上限 3500 字≈5K tokens
console.log(`③ until=${row?.compressed_until}（应为 32，请求口径）→ ${okU ? "✅" : "❌"}`);
console.log(`④ 摘要 ${len} 字（应 >2000，上限 3500≈5K tokens）→ ${okL ? "✅" : "❌"}`);
fs.mkdirSync("docs/delivery/evidence/T5", { recursive: true });
fs.writeFileSync("docs/delivery/evidence/T5/压缩产物样本.md", `# T5 证据：压缩放宽产物样本（2026-06-11 实测）\n\n- 源：32 条高密度旧消息共 ${srcChars} 字 → 摘要 ${len} 字（旧上限 1500 tokens≈千字；新上限 3500 字≈5K tokens）\n- compressed_until=${row?.compressed_until}（请求口径）\n\n## 摘要全文\n\n${row?.compressed_history ?? "（未生成）"}\n`);
console.log("   样本已存 docs/delivery/evidence/T5/压缩产物样本.md");

// ⑤ 跨压缩记忆
const a = await ask("只根据你对我的了解回答：我的职业是什么？我的猫叫什么名字？");
const okM = /语文老师/.test(a.content ?? "") && /年糕/.test(a.content ?? "");
console.log(`⑤ 跨压缩记忆：${okM ? "✅ 记得职业与猫名" : "⚠️ 人工判断"}｜回答节选: ${String(a.content ?? "").replace(/\n/g, " ").slice(0, 120)}`);

// 恢复 demo main 原样（备份-还原模式，绝不残留测试数据）
if (mainBackup) await admin.from("chat_sessions").upsert(mainBackup, { onConflict: "user_id,id" });
else await admin.from("chat_sessions").delete().eq("user_id", uid).eq("id", SID);
console.log(okU && okL && okM ? "\n✅ 压缩放宽验证通过（demo main 已恢复原样）" : "\n⚠️ 有项未达标（demo main 已恢复原样）");
process.exit(okU && okL && okM ? 0 : 1);
