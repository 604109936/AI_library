// Supabase 浏览器端客户端（单例）。
// 架构：前端用 anon（匿名公开）key 直连 Supabase，安全主防线是数据库 RLS。
// 仅此一个客户端用于全 APP 的读写与鉴权；service_role（最高权限）只在本地脚本里用，绝不进前端。
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "缺少 Supabase 环境变量：请在项目根目录 .env.local 配置 " +
      "NEXT_PUBLIC_SUPABASE_URL 与 NEXT_PUBLIC_SUPABASE_ANON_KEY（见 .env.local.example）。"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true, // 登录态存 localStorage，刷新不掉线
    autoRefreshToken: true, // 自动续期 token
    detectSessionInUrl: true, // 处理邮件确认/找回密码等回跳链接
  },
});
