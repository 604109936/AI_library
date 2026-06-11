// 线上重放荐书/答疑，看服务端事件与回答
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: auth } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
// 取 demo main 现有 4 条历史，模拟 UI 场景（带历史的荐书）
const { data: row } = await admin.from("chat_sessions").select("messages").eq("user_id", auth.user.id).eq("id", "main").maybeSingle();
const hist = (row?.messages ?? []).map((m) => ({ role: m.role, content: String(m.content) }));
console.log(`带 ${hist.length} 条 demo 历史重放：`);
for (const q of ["从馆里挑两本适合我现在读的书，说说为什么"]) {
  const t0 = Date.now();
  const r = await fetch("https://www.goodcontent.cn/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${auth.session.access_token}` },
    body: JSON.stringify({ stream: false, messages: [...hist, { role: "user", content: q }] }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json().catch(() => null);
  console.log(`Q: ${q.slice(0, 16)} | HTTP ${r.status} | ${Date.now() - t0}ms | events=${JSON.stringify((j?.events ?? []).map((e) => e.t))}`);
  console.log("正文尾部：", String(j?.content ?? j?.error ?? "").slice(-200).replace(/\n/g, " "));
}
