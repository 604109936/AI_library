// 注销账号云函数（T4.2）：验证调用者身份后用 service_role 删除 auth 账号。
// 用户数据表（profiles/favorites/notes/reviews/…/chat_sessions）全部 on delete cascade 级联清除。
import { NextRequest, NextResponse } from "next/server";
import { admin, getUid } from "@/lib/server/agent";
import { DEMO_EMAIL } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const uid = await getUid(req.headers.get("authorization"));
  if (!uid) return NextResponse.json({ error: "未登录或登录态已失效" }, { status: 401 });
  // 共享体验账号不允许注销（前端已拦 UI 入口，这里防直接调 API——Review P0）。
  // fail-closed：getUserById 抖动/返回空时绝不放行，否则全员共用的 demo 账号可能在那一瞬被删（Bug#5）
  const { data: who, error: whoErr } = await admin.auth.admin.getUserById(uid);
  if (whoErr || !who?.user) {
    return NextResponse.json({ error: "无法确认账号身份，请稍后重试" }, { status: 503 });
  }
  if (who.user.email === DEMO_EMAIL) {
    return NextResponse.json({ error: "体验账号是大家共用的，不能注销" }, { status: 403 });
  }
  // 头像存储无级联，必须主动清：注销承诺「云端数据全部清除」，公开桶里残留头像属隐私不闭环。
  // 整目录列删（而非猜文件名），失败不阻断删号（孤儿文件好过删号失败）但记日志。
  try {
    const { data: files } = await admin.storage.from("avatars").list(uid);
    if (files?.length) {
      const { error: rmErr } = await admin.storage.from("avatars").remove(files.map((f) => `${uid}/${f.name}`));
      if (rmErr) console.error("[account/delete] 头像清理失败", rmErr);
    }
  } catch (e) {
    console.error("[account/delete] 头像清理异常", e);
  }
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) {
    // 幂等：双击/前端重试时账号可能已被上一次请求删掉——「用户不存在」视作注销成功，
    // 否则用户看到"注销失败"但账号实际已删（Review P2）
    const notFound = (error as any)?.status === 404 || /not.*found/i.test(String(error.message ?? ""));
    if (notFound) return NextResponse.json({ ok: true });
    console.error("[account/delete]", error);
    return NextResponse.json({ error: "注销失败，请稍后重试" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
