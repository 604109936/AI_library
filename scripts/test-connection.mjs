// Supabase 连接自测：用 anon key 读公开的 categories 表（应返回 0 行、无报错）。
// 运行：node --env-file=.env.local scripts/test-connection.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon || url.includes("请粘贴") || anon.includes("请粘贴")) {
  console.error(
    "❌ 没读到有效环境变量。请确认：\n" +
      "   1) .env.local 里三个值已换成真实值（不再是「请粘贴...」占位符）\n" +
      "   2) 运行命令带了 --env-file=.env.local"
  );
  process.exit(1);
}

const supabase = createClient(url, anon);
const { data, error, count } = await supabase
  .from("categories")
  .select("*", { count: "exact" });

if (error) {
  console.error("❌ 连接失败：", error.message);
  console.error("   常见原因：URL/anon key 复制错、或第①批目录表没建成功。");
  process.exit(1);
}

console.log(`✅ 连接成功！categories 表当前 ${count ?? data.length} 行（空表正常，书库数据下一步 3.2 导入）。`);
