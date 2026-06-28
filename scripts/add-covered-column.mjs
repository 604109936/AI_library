// 给 media_progress 加 covered 列（覆盖率区间并集持久化用），并刷新 PostgREST schema 缓存。
// 运行：node --env-file=.env.local scripts/add-covered-column.mjs
import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }, // Supabase 直连需 SSL
});
await client.connect();
try {
  await client.query(`ALTER TABLE public.media_progress ADD COLUMN IF NOT EXISTS covered jsonb NOT NULL DEFAULT '[]'::jsonb;`);
  console.log("✓ media_progress.covered 列已就绪");
  // 让 PostgREST 立刻重载 schema（否则缓存里仍认为没这列，写库继续报错）
  await client.query(`NOTIFY pgrst, 'reload schema';`);
  console.log("✓ 已通知 PostgREST 重载 schema 缓存");
} finally {
  await client.end();
}
