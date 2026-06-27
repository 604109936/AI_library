// 体验账号云函数：每次点击「体验账号」都即时创建一个**独立**的新账号（昵称：体验书友N），
// 各体验用户数据互不串档（替代旧的「全员共用一个 demo 账号」方案）。这些账号属脏数据，后台定期清理。
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server/agent";
import { rateLimit, limiterKey } from "@/lib/server/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: NextRequest) {
  // 轻量防滥用：同一 IP 10 分钟内最多开 8 个体验账号（正常用户点一次足够；脏数据后台定期清）
  const ip = limiterKey(null, req.headers.get("x-forwarded-for"));
  if (!(await rateLimit(`demo:${ip}`, 8, 600_000))) {
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
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nickname },
    });
    if (error) {
      console.error("[/api/demo] 创建体验账号失败", error);
      return NextResponse.json({ error: "体验账号创建失败，请稍后重试" }, { status: 502 });
    }
    // 返回凭据供前端立即登录（throwaway 账号，HTTPS 下回传无碍）
    return NextResponse.json({ email, password, nickname });
  } catch (e) {
    console.error("[/api/demo]", e);
    return NextResponse.json({ error: "体验账号创建失败，请稍后重试" }, { status: 500 });
  }
}
