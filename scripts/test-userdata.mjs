// 3.5 用户数据端到端自测：登录体验账号 → 写一遍各类用户数据 → 读回校验 → RLS 隔离 → 清理。
// 运行：node --env-file=.env.local scripts/test-userdata.mjs
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, anon, { auth: { persistSession: false } });

const BOOK = "the-untethered-soul";
const CH1 = `${BOOK}-c1`;
const CH3 = `${BOOK}-c3`;
const ok = (b, m) => console.log(`${b ? "✓" : "❌"} ${m}`);
let failed = false;
const must = (b, m) => { ok(b, m); if (!b) failed = true; };

// 登录
const { data: si, error: e1 } = await sb.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
if (e1) { console.error("❌ 登录失败：", e1.message); process.exit(1); }
const uid = si.user.id;
console.log(`✓ 登录体验账号 uid=${uid.slice(0, 8)}…\n--- 写入各类用户数据 ---`);

// 1) 收藏
must(!(await sb.from("favorites").insert({ user_id: uid, book_id: BOOK })).error, "写 收藏");
// 2) 笔记（uuid）
const noteId = randomUUID();
must(!(await sb.from("notes").insert({ id: noteId, user_id: uid, book_id: BOOK, chapter_id: CH1, excerpt: "脑海中的声音", note: "测试笔记", color: "#8FB39B", start_offset: 0, end_offset: 6 })).error, "写 笔记");
// 3) 书评（upsert by user_id,book_id）
must(!(await sb.from("reviews").upsert({ user_id: uid, book_id: BOOK, rating: 4.5, title: "好书", content: "很有启发" }, { onConflict: "user_id,book_id" })).error, "写 书评");
// 4) 历史
must(!(await sb.from("reading_history").upsert({ user_id: uid, book_id: BOOK, mode_category: "text", progress: 50, last_at: new Date().toISOString() }, { onConflict: "user_id,book_id,mode_category" })).error, "写 历史");
// 5) 文字进度
must(!(await sb.from("text_progress").upsert({ user_id: uid, book_id: BOOK, last_chapter_id: CH3, last_chapter_no: 3, pct: 60, read_chapter_ids: [CH1, `${BOOK}-c2`, CH3] }, { onConflict: "user_id,book_id" })).error, "写 文字进度");
// 6) 音视频进度
must(!(await sb.from("media_progress").upsert({ user_id: uid, book_id: BOOK, position: 0.2, played: 0.2 }, { onConflict: "user_id,book_id" })).error, "写 音视频进度");
// 7) 学习总时长
must(!(await sb.from("profiles").update({ read_seconds: 1200 }).eq("id", uid)).error, "写 学习总时长");

console.log("--- 读回校验（含 books/chapters JS 拼接） ---");
const fav = (await sb.from("favorites").select("book_id").eq("user_id", uid)).data ?? [];
must(fav.some((r) => r.book_id === BOOK), `收藏读回（${fav.length} 条）`);
const notes = (await sb.from("notes").select("*").eq("user_id", uid)).data ?? [];
must(notes.length >= 1 && notes[0].chapter_id === CH1, "笔记读回");
const bk = (await sb.from("books").select("id,title").in("id", [BOOK])).data ?? [];
must(bk[0]?.title === "清醒地活", `按 id 批量查 books 拼书名：${bk[0]?.title}`);
const ch = (await sb.from("chapters").select("id,title").in("id", [CH1])).data ?? [];
must(ch[0]?.title === "脑海中的声音", `按 id 批量查 chapters 拼章标题：${ch[0]?.title}`);
const tp = (await sb.from("text_progress").select("*").eq("user_id", uid).maybeSingle()).data;
must(tp?.pct === 60 && (tp?.read_chapter_ids ?? []).length === 3, "文字进度读回(60%,3章已读)");
const prof = (await sb.from("profiles").select("read_seconds").eq("id", uid).maybeSingle()).data;
must(prof?.read_seconds === 1200, "学习总时长读回(1200s)");

console.log("--- RLS 隔离 ---");
const anonOnly = createClient(url, anon, { auth: { persistSession: false } });
const leak = (await anonOnly.from("favorites").select("book_id")).data ?? [];
must(leak.length === 0, `未登录读 favorites 返回 ${leak.length} 行（应 0，RLS 拦截）`);
const pub = (await anonOnly.from("books").select("id")).data ?? [];
must(pub.length >= 1, `未登录读 books（公开）返回 ${pub.length} 行（应≥1）`);

console.log("--- 清理（恢复体验账号干净） ---");
await sb.from("favorites").delete().eq("user_id", uid);
await sb.from("notes").delete().eq("user_id", uid);
await sb.from("reviews").delete().eq("user_id", uid);
await sb.from("reading_history").delete().eq("user_id", uid);
await sb.from("text_progress").delete().eq("user_id", uid);
await sb.from("media_progress").delete().eq("user_id", uid);
await sb.from("profiles").update({ read_seconds: 0 }).eq("id", uid);
console.log("✓ 已清理");
await sb.auth.signOut();

console.log(failed ? "\n❌ 有用例未通过" : "\n✅ 3.5 用户数据 写穿透/读回/RLS 全部通过");
process.exit(failed ? 1 : 0);
