// 复现「笔记保存报错」：用体验账号按前端真实字段插 notes，打印真实错误。
// 运行：node --env-file=.env.local scripts/test-note-insert.mjs
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, anon, { auth: { persistSession: false } });

const { data: si, error: e1 } = await sb.auth.signInWithPassword({ email: "demo@ailibrary.app", password: "123456" });
if (e1) { console.error("登录失败:", e1.message); process.exit(1); }
const uid = si.user.id;

// 模拟前端 db.addNote 的真实载荷（高亮：note=""；start/end 为字符偏移）
const cases = [
  { name: "高亮(note空, start/end 数字)", row: { id: randomUUID(), user_id: uid, book_id: "the-untethered-soul", chapter_id: "the-untethered-soul-c1", excerpt: "脑海中的声音", note: "", color: "#8FB39B", start_offset: 12, end_offset: 18 } },
  { name: "笔记(有 note)", row: { id: randomUUID(), user_id: uid, book_id: "the-untethered-soul", chapter_id: "the-untethered-soul-c1", excerpt: "我今天有点累", note: "测试一下笔记内容", color: "#D9C08A", start_offset: 30, end_offset: 36 } },
  { name: "start=-1(locate 未命中)", row: { id: randomUUID(), user_id: uid, book_id: "the-untethered-soul", chapter_id: "the-untethered-soul-c1", excerpt: "某段文字", note: "", color: "#D69A95", start_offset: -1, end_offset: 3 } },
];

for (const c of cases) {
  const { error } = await sb.from("notes").insert(c.row);
  if (error) {
    console.log(`❌ ${c.name} 失败：code=${error.code} msg=${error.message}`);
    if (error.details) console.log(`   details: ${error.details}`);
    if (error.hint) console.log(`   hint: ${error.hint}`);
  } else {
    console.log(`✓ ${c.name} 成功`);
  }
}

// 清理
await sb.from("notes").delete().eq("user_id", uid);
await sb.auth.signOut();
console.log("（已清理测试笔记）");
