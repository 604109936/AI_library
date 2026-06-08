// 验证 service_role(Secret) key 能否绕过 RLS 写库：插入一条临时分类 → 读回 → 删除。
// 运行：node --env-file=.env.local scripts/test-write.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !secret || secret.includes("请粘贴")) {
  console.error("❌ 没读到有效的 SUPABASE_SERVICE_ROLE_KEY，请确认 .env.local 里 Secret key 已填好。");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });
const testId = "__write_test__";

// 0) 先清掉可能残留的测试行（幂等）
await admin.from("categories").delete().eq("id", testId);

// 1) 插入
const { error: insErr } = await admin
  .from("categories")
  .insert({ id: testId, name: "写库自测", icon: "Bug", sort_order: 999 });
if (insErr) {
  console.error("❌ 写入失败：", insErr.message);
  console.error("   多半是 Secret key 不对（应为 sb_secret_ 开头），或不是 service_role/secret 级别。");
  process.exit(1);
}

// 2) 读回确认
const { data, error: selErr } = await admin
  .from("categories")
  .select("id,name")
  .eq("id", testId)
  .single();
if (selErr || !data) {
  console.error("❌ 写入后读回失败：", selErr?.message ?? "没读到");
  process.exit(1);
}

// 3) 删除清理
const { error: delErr } = await admin.from("categories").delete().eq("id", testId);
if (delErr) {
  console.error("⚠️ 测试行写入/读取成功，但删除失败（请手动删 categories 里 id=__write_test__）：", delErr.message);
  process.exit(1);
}

console.log("✅ Secret key 写库验证通过！插入→读回→删除全部成功，service_role 写权限正常。");
console.log("   （测试行已清理，categories 表恢复为空，可以开始 3.2 导书。）");
