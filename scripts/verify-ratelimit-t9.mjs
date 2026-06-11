// T9 验收：限流恰在新阈值触发（登录 20 次/分、游客 8 次/分），提示为友好中文
// 巧用空 messages 请求：先过限流计数、再被"缺少用户消息"挡下（400）——不烧任何 LLM token
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });

async function hit(token) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : { "x-forwarded-for": "203.0.113.77" }) },
    body: JSON.stringify({ stream: false, messages: [] }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/* 登录：前 20 次过限流（400 缺消息），第 21 次 429 */
let statuses = [];
for (let i = 0; i < 21; i++) statuses.push((await hit(auth.session.access_token)).status);
const first429 = statuses.findIndex((s) => s === 429) + 1;
ok(statuses.slice(0, 20).every((s) => s === 400) && statuses[20] === 429, "① 登录用户恰在第 21 次触发限流（20 次/分）", `首个 429 出现在第 ${first429} 次`);
const last = await hit(auth.session.access_token);
ok(last.status === 429 && /歇口气/.test(last.body?.error ?? ""), "②限流提示为友好中文", last.body?.error);

/* 游客（独立 IP key）：前 8 次过，第 9 次 429 */
statuses = [];
for (let i = 0; i < 9; i++) statuses.push((await hit(null)).status);
ok(statuses.slice(0, 8).every((s) => s === 400) && statuses[8] === 429, "③ 游客恰在第 9 次触发限流（8 次/分）", JSON.stringify(statuses));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
