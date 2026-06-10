// 验证 T2.2：①游客问馆藏 → 回答含真实书名（书单变量生效）②登录 demo 问个人数据 → 回答含登录态/时长（用户变量生效）
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";

async function ask(q, token) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return String(j.content ?? "");
}

// ① 游客：馆藏书单变量
const a1 = await ask("请列出馆里全部书的书名，一行一本，不要多余解释");
const titles = ["清醒地活", "认知觉醒", "被讨厌的勇气", "了凡四训", "格调", "你当像鸟飞往你的山", "人生只有一件事"];
const hit = titles.filter((t) => a1.includes(t));
console.log(`① 游客问馆藏：命中真实书名 ${hit.length}/7 → ${hit.length >= 6 ? "✅" : "❌"}`);
console.log("   回答节选:", a1.replace(/\n/g, " | ").slice(0, 220));

// ② 登录 demo：个人数据变量
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error } = await sb.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
if (error) { console.log("❌ demo 登录失败:", error.message); process.exit(1); }
const a2 = await ask("如实回答：我现在是登录状态吗？我的学习总时长是多少？我有正在读或收藏的书吗？", auth.session.access_token);
const okLogin = !/未登录|没有登录|游客/.test(a2) && /(时长|分钟|小时)/.test(a2);
console.log(`② demo 登录问个人数据：${okLogin ? "✅ 识别登录态并给出时长" : "⚠️ 看回答人工判断"}`);
console.log("   回答节选:", a2.replace(/\n/g, " | ").slice(0, 300));

// ③ 反幻觉：问馆里没有的书
const a3 = await ask("馆里有《三体》吗？有的话推荐给我");
console.log(`③ 反幻觉（馆里无《三体》）：${/(没有|暂无|不在馆|未收录|遗憾)/.test(a3) ? "✅ 如实说没有" : "⚠️ 看回答人工判断"}`);
console.log("   回答节选:", a3.replace(/\n/g, " | ").slice(0, 220));
