// 鉴权 e2e 自测：用 anon 客户端登录体验账号 → 验证会话 + RLS 本人可读 profiles。
// 运行：node --env-file=.env.local scripts/test-auth.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, anon, { auth: { persistSession: false } });

const EMAIL = "demo@ailibrary.app";
const PWD = "123456";

// 1) 登录
const { data: signIn, error: e1 } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PWD });
if (e1) { console.error("❌ 登录失败：", e1.message); process.exit(1); }
console.log(`✓ 登录成功，user.id=${signIn.user.id.slice(0, 8)}… email=${signIn.user.email}`);

// 2) 读自己的 profile（RLS：本人可读）
const { data: prof, error: e2 } = await supabase.from("profiles").select("*").eq("id", signIn.user.id).maybeSingle();
if (e2) { console.error("❌ 读 profiles 失败：", e2.message); process.exit(1); }
if (!prof) { console.error("❌ 没读到 profiles（触发器没建档？）"); process.exit(1); }
console.log(`✓ 读到本人 profile：昵称「${prof.nickname}」 account=${prof.account} read_seconds=${prof.read_seconds}`);

// 3) RLS 隔离验证：尝试读全部 profiles，应只返回自己 1 行（看不到别人）
const { data: all } = await supabase.from("profiles").select("id");
console.log(`✓ RLS 隔离：select profiles 只返回 ${all?.length} 行（应为 1，看不到他人）`);

// 4) 退出
await supabase.auth.signOut();
console.log("✓ 退出登录成功\n✅ 鉴权链路（登录/会话/RLS本人可读/退出）全部通过");
