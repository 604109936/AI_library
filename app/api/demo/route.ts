// 体验账号云函数：每次点击「体验账号」都即时创建一个**独立**的新账号（昵称：体验书友N），
// 各体验用户数据互不串档（替代旧的「全员共用一个 demo 账号」方案）。这些账号属脏数据，后台定期清理。
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server/agent";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: NextRequest) {
  // 防滥用双闸（每次成功都用 service_role 建一个真实已确认 auth 用户，必须挡批量灌号）：
  // ① 单 IP 10 分钟 8 个；② 全站 10 分钟 60 个——后者防"伪造/轮换 XFF 让 IP key 永远不同"绕过单 IP 限流。
  // IP 取可信来源(x-real-ip/x-vercel-forwarded-for)而非可伪造的 XFF 首段；配 KV 后两闸跨实例严格生效。
  const ip = clientIp(req.headers);
  // 必须串行短路：被单 IP 闸拦下的请求绝不能再消耗全局桶（原并行 Promise.all 里被拒请求照样给
  // demo:global +1，一个 IP 狂刷≈60 次就灌满全局 60/10min，令其他 IP 正常用户集体 429——防滥用闸反成 DoS 放大器）。
  // 全局桶只统计「真正会建号」的请求（过了单 IP 闸的）。
  if (!(await rateLimit(`demo:ip:${ip}`, 8, 600_000))) {
    return NextResponse.json({ error: "体验太频繁了，歇会儿再来" }, { status: 429 });
  }
  if (!(await rateLimit("demo:global", 60, 600_000))) {
    return NextResponse.json({ error: "体验太频繁了，歇会儿再来" }, { status: 429 });
  }
  try {
    // 「体验书友N」序号：现有「体验书友%」昵称数 + 1（并发偶发重号无妨，仅展示用、昵称无需唯一）
    let n = 1;
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .like("nickname", "体验书友%");
    if (typeof count === "number") n = count + 1;
    const nickname = `体验书友${n}`;

    // 唯一邮箱 + 随机密码；email_confirm 直接确认 → 免邮箱验证即可立刻用密码登录。
    // 邮箱前缀 demo- 便于后台批量识别/清理。
    const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
    const email = `demo-${tag}@ailibrary.app`;
    const password = `Dq${tag}${Math.random().toString(36).slice(2, 10)}`;

    // user_metadata.nickname 由 handle_new_user 触发器写入 profiles（与正常注册同一机制）
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nickname },
    });
    if (error) {
      console.error("[/api/demo] 创建体验账号失败", error);
      return NextResponse.json({ error: "体验账号创建失败，请稍后重试" }, { status: 502 });
    }
    // 体验账号默认头像统一用第 8 个预设（a8.webp）：触发器建好 profiles 行后改其 avatar_seed。
    // 失败不致命（仅头像回落默认种子），故 catch 静默。
    if (created?.user?.id) {
      await admin.from("profiles").update({ avatar_seed: 8 }).eq("id", created.user.id);
    }
    // 返回凭据供前端立即登录（throwaway 账号，HTTPS 下回传无碍）
    return NextResponse.json({ email, password, nickname });
  } catch (e) {
    console.error("[/api/demo]", e);
    return NextResponse.json({ error: "体验账号创建失败，请稍后重试" }, { status: 500 });
  }
}
