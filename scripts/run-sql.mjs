// 直连数据库执行 SQL（建函数/触发器/运维变更专用；密钥只读 .env.local 的 SUPABASE_DB_URL）
// 用法：node scripts/run-sql.mjs <文件.sql | 文档.md | -e "select 1">
//   .md 文件：自动抽取其中全部 ```sql 代码块按序执行
//   每次执行包在单个连接里；任何一步报错立即终止并打印出错语句位置
import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const url = process.env.SUPABASE_DB_URL;
if (!url || url.includes("在这里填")) { console.log("❌ .env.local 的 SUPABASE_DB_URL 还没填真实密码"); process.exit(1); }

const arg = process.argv[2];
if (!arg) { console.log("用法：node scripts/run-sql.mjs <文件.sql|文档.md|-e \"SQL\">"); process.exit(1); }
let sql = "";
if (arg === "-e") sql = process.argv[3] ?? "";
else {
  const raw = fs.readFileSync(arg, "utf8");
  if (arg.endsWith(".md")) {
    const blocks = [...raw.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
    if (!blocks.length) { console.log("❌ 文档中没有 ```sql 代码块"); process.exit(1); }
    sql = blocks.join("\n\n");
    console.log(`从 ${arg} 抽取 ${blocks.length} 个 SQL 块`);
  } else sql = raw;
}
if (!sql.trim()) { console.log("❌ SQL 为空"); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
try {
  await client.connect();
  const r = await client.query(sql); // 多语句一次提交（pg 支持 simple query 多语句）
  const results = Array.isArray(r) ? r : [r];
  for (const res of results) {
    if (res.command === "SELECT" && res.rows?.length) console.table(res.rows.slice(0, 50));
    else console.log(`✓ ${res.command ?? "OK"}${typeof res.rowCount === "number" ? ` (${res.rowCount} 行)` : ""}`);
  }
  console.log("✅ 执行完成");
} catch (e) {
  console.log("❌ 执行失败:", e.message);
  if (e.position) {
    const pos = Number(e.position);
    console.log("出错位置附近:", JSON.stringify(sql.slice(Math.max(0, pos - 80), pos + 80)));
  }
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
