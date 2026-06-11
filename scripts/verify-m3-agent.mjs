// T5 验证：M3 全量切换后的智学链路
//   ① 多轮工具调用对话（答疑：必经 toc→read_chapter→cite 多轮）正常完成
//   ② 回答正文无 <think> 思考段泄漏、无占位标记泄漏
//   ③ 卡片事件正常下发（cites/recs）
//   ④ 思考链回灌证据由 dev 日志（AGENT_DEBUG=1 的 [agent-debug] 行）配合留存
// 直连 /api/chat?stream=false（JSON 模式），不走浏览器，聚焦服务端行为
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`); cond ? pass++ : fail++; };

async function ask(q) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stream: false, messages: [{ role: "user", content: q }] }),
    signal: AbortSignal.timeout(180000),
  });
  return r.json();
}

/* ① 答疑（必然多轮：toc → read_chapter → cite_chapters） */
console.log("—— 答疑问题（驱动多轮工具循环）——");
const a = await ask("《认知觉醒》第二章具体讲了什么？引用一点原文说说");
ok(typeof a.content === "string" && a.content.length > 50, "① 多轮工具对话正常完成", `回答 ${a.content?.length ?? 0} 字`);
ok(!a.content.includes("<think>") && !a.content.includes("</think>"), "② 正文无 <think> 思考段泄漏");
ok(!a.content.includes("[["), "②b 正文无占位标记泄漏");
const hasCites = (a.events ?? []).some((e) => e.t === "cites");
ok(hasCites, "③ 引用卡事件正常下发", JSON.stringify(a.events?.map((e) => e.t)));

/* ②′ 荐书（recs 事件） */
console.log("—— 荐书问题 ——");
const b = await ask("给我推荐一本提升思维认知的馆藏书，说说理由");
ok(typeof b.content === "string" && !b.content.includes("<think>"), "④ 荐书回答无思考泄漏", `回答 ${b.content?.length ?? 0} 字`);
ok((b.events ?? []).some((e) => e.t === "recs"), "⑤ 推荐卡事件正常下发", JSON.stringify(b.events?.map((e) => e.t)));

console.log(`\n回答①样本（前160字）：${a.content?.slice(0, 160)}`);
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
