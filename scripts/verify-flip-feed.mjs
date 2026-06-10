// T3.1/T3.2 验证：触发 flip-feed Cron → 校验 demo 用户当天 feed 符合全部规则
//   ① 鉴权：无密钥 401；② 生成：demo 有行、≤50 本、全部有视频；③ 排除已读完；④ 在读置顶；⑤ 幂等：二跑跳过
// 用法：先起 dev（pnpm dev），再 node scripts/verify-flip-feed.mjs
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const BASE = process.env.E2E_BASE || "http://127.0.0.1:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? `（${extra}）` : ""}`);
  cond ? pass++ : fail++;
};

// ① 未授权拒绝
const r401 = await fetch(`${BASE}/api/cron/flip-feed`);
ok(r401.status === 401, "无密钥调用被拒（401）", `实际 ${r401.status}`);

// ② 带密钥强制生成
const r = await fetch(`${BASE}/api/cron/flip-feed?force=1`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
const stats = await r.json();
ok(r.ok, "Cron 接口调用成功", JSON.stringify(stats));

// demo 用户
const { data: demoUser } = await admin.from("profiles").select("id,nickname").eq("account", "demo@ailibrary.app").maybeSingle();
const demo = demoUser ?? (await admin.auth.admin.listUsers().then((x) => {
  const u = x.data.users.find((u) => u.email === "demo@ailibrary.app");
  return u ? { id: u.id, nickname: "demo" } : null;
}));
if (!demo) { console.log("❌ 找不到 demo 账号"); process.exit(1); }

const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const { data: feedRow } = await admin.from("flip_feed").select("book_ids,gen_date").eq("user_id", demo.id).eq("gen_date", today).maybeSingle();
ok(!!feedRow, "demo 当天 feed 已生成", feedRow ? `${feedRow.book_ids.length} 本` : "无行");

if (feedRow) {
  const ids = feedRow.book_ids;
  ok(ids.length <= 50, "数量 ≤50", `${ids.length}`);
  ok(new Set(ids).size === ids.length, "无重复书");

  const { data: books } = await admin.from("books").select("id,title,video_url,has_video").in("id", ids);
  const bmap = new Map((books ?? []).map((b) => [b.id, b]));
  ok(ids.every((id) => bmap.get(id)?.has_video && bmap.get(id)?.video_url), "全部有视频");

  // 重算 demo 的已读完/在读（与生成器同口径）
  const [tp, mp] = await Promise.all([
    admin.from("text_progress").select("book_id,pct,last_chapter_no").eq("user_id", demo.id),
    admin.from("media_progress").select("book_id,position,played").eq("user_id", demo.id),
  ]);
  const done = new Set(), reading = new Set();
  for (const r of tp.data ?? []) r.pct >= 100 ? done.add(r.book_id) : (r.pct > 0 || r.last_chapter_no) && reading.add(r.book_id);
  for (const r of mp.data ?? []) Number(r.played) >= 0.9 ? done.add(r.book_id) : (Number(r.played) > 0 || Number(r.position) > 0) && reading.add(r.book_id);
  done.forEach((id) => reading.delete(id));

  ok(ids.every((id) => !done.has(id)), "已读完的书全部排除", `已读完 ${done.size} 本`);
  const readingInFeed = ids.filter((id) => reading.has(id));
  const firstNonReading = ids.findIndex((id) => !reading.has(id));
  const readingAllFirst = readingInFeed.every((id, i) => ids[i] === id);
  ok(readingInFeed.length === 0 || readingAllFirst, "在读的书置顶", `在读且有视频 ${readingInFeed.length} 本，首个非在读位于第 ${firstNonReading + 1} 位`);

  console.log("\n📖 demo 的今日乱翻 feed（顺序即播放序）：");
  ids.forEach((id, i) => console.log(`  ${i + 1}. 《${bmap.get(id)?.title ?? id}》${reading.has(id) ? "〔在读〕" : ""}`));
}

// ⑤ 幂等：不带 force 再跑一次应跳过已生成用户
const r2 = await fetch(`${BASE}/api/cron/flip-feed`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
const stats2 = await r2.json();
ok(r2.ok && stats2.generated === 0 && stats2.skippedExisting > 0, "幂等：二跑跳过已生成用户", JSON.stringify(stats2));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
