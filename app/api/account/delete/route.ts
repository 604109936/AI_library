// 注销账号云函数（T4.2）：验证调用者身份后用 service_role 删除 auth 账号。
// 用户数据表（profiles/favorites/notes/reviews/…/chat_sessions）全部 on delete cascade 级联清除。
import { NextRequest, NextResponse } from "next/server";
import { admin, getUid } from "@/lib/server/agent";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const uid = await getUid(req.headers.get("authorization"));
  if (!uid) return NextResponse.json({ error: "未登录或登录态已失效" }, { status: 401 });
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) {
    console.error("[account/delete]", error);
    return NextResponse.json({ error: "注销失败，请稍后重试" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
