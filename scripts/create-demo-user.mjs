// 建/重置「体验账号」（真实 Supabase 用户，已确认邮箱，可一键登录）。
// 运行：node --env-file=.env.local scripts/create-demo-user.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret || String(secret).includes("请粘贴")) {
  console.error("❌ 缺少 SUPABASE_SERVICE_ROLE_KEY，确认 .env.local 已填且带了 --env-file=.env.local");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { persistSession: false } });

const EMAIL = "demo@ailibrary.app";
const PASSWORD = "123456";
const NICKNAME = "体验书友";

// 已存在则跳过创建（幂等）
const { data: list } = await admin.auth.admin.listUsers();
let user = (list?.users ?? []).find((u) => u.email === EMAIL);

if (user) {
  console.log(`体验账号已存在（${EMAIL}），跳过创建。`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true, // 直接标记邮箱已确认，无论后台验证开关都能登录
  });
  if (error) {
    console.error("❌ 创建失败：", error.message);
    process.exit(1);
  }
  user = data.user;
  console.log(`✓ 已创建体验账号：${EMAIL} / ${PASSWORD}`);
}

// 设置昵称（触发器已自动建 profiles 行）
if (user) {
  const { error } = await admin.from("profiles").update({ nickname: NICKNAME }).eq("id", user.id);
  if (error) console.error("⚠️ 设置昵称失败：", error.message);
  else console.log(`✓ 昵称已设为「${NICKNAME}」`);
}

console.log(`\n体验账号就绪：邮箱 ${EMAIL}　密码 ${PASSWORD}`);
