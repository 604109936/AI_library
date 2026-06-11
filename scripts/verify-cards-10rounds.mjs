// T3 验收：连续 10 轮含卡片场景对话，零失配
//   失配定义：① 明确推荐/答疑请求没有对应工具事件 ② 正文提及"卡片"却没有任何事件 ③ <think>/[[ 泄漏
//   完整请求与事件日志留存 docs/delivery/evidence/T3/10rounds-log.json
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;

// demo 登录拿 token（个性化数据让荐书更真实）；备份 main 防压缩等副作用
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: auth } = await anon.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: backup } = await admin.from("chat_sessions").select("*").eq("user_id", auth.user.id).eq("id", "main").maybeSingle();

// 模拟"此前已推荐过"的历史（单一会话最易失配的场景）
const HIST = [
  { role: "user", content: "推荐一本提升认知的书" },
  { role: "assistant", content: "我推荐《认知觉醒》，它讲透了大脑运作与自我改变的底层逻辑。已经把它放进卡片里了，点开就能读。" },
];

const ROUNDS = [
  { q: "推荐一本提升认知的书", expect: "recs" },
  { q: "再给我挑两本适合通勤路上听的书", expect: "recs", hist: HIST }, // 历史里刚推荐过——重复推荐也必须出卡
  { q: "《了凡四训》第一章讲了什么？", expect: "cites" },
  { q: "我最近有点焦虑，有什么书能帮我？", expect: "recs" },
  { q: "《被讨厌的勇气》里说的课题分离是什么意思？", expect: "cites" },
  { q: "馆里有讲原生家庭的书吗？有的话推给我", expect: "recs" },
  { q: "这两本先读哪本？", expect: null, hist: HIST }, // 灰色轮：只做通用失配检查
  { q: "《认知觉醒》和《清醒地活》哪本更适合入门？把更适合的那本推给我", expect: "recs", hist: HIST },
  { q: "引用《格调》的原文说说什么是品味", expect: "cites" },
  { q: "随便推荐一本馆里的书给我", expect: "recs", hist: HIST },
];

let pass = 0, fail = 0;
const log = [];
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

for (let i = 0; i < ROUNDS.length; i++) {
  const r = ROUNDS[i];
  const messages = [...(r.hist ?? []), { role: "user", content: r.q }];
  const resp = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${auth.session.access_token}` },
    body: JSON.stringify({ stream: false, messages }),
    signal: AbortSignal.timeout(180000),
  }).then((x) => x.json());
  const content = String(resp.content ?? "");
  const kinds = (resp.events ?? []).map((e) => e.t);
  log.push({ round: i + 1, q: r.q, hist: !!r.hist, expect: r.expect, events: resp.events, content });

  const mentionsCard = /卡片/.test(content);
  const issues = [];
  if (r.expect && !kinds.includes(r.expect)) issues.push(`缺 ${r.expect} 事件`);
  if (mentionsCard && kinds.length === 0) issues.push("正文提卡片但零事件");
  if (content.includes("<think>") || content.includes("[[")) issues.push("泄漏");
  if (!content.trim() && kinds.length === 0) issues.push("空回答");
  ok(issues.length === 0, `第 ${i + 1} 轮「${r.q.slice(0, 18)}…」`, issues.length ? issues.join("/") : `events=[${kinds.join(",")}] ${content.length}字`);
}

fs.mkdirSync("docs/delivery/evidence/T3", { recursive: true });
fs.writeFileSync("docs/delivery/evidence/T3/10rounds-log.json", JSON.stringify(log, null, 2));
console.log("完整日志已存 docs/delivery/evidence/T3/10rounds-log.json");

// 恢复 demo main（stream=false 不落库，但压缩 waitUntil 可能改 compressed_*；保险起见还原）
if (backup) await admin.from("chat_sessions").upsert(backup, { onConflict: "user_id,id" });
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
