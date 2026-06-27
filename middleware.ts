// 调试后台仅限本地：任何 Vercel 部署（生产 / 预览）上 /admin 与 /api/admin 一律 404。
// 原因：该后台无登录验证，公开站点上会按邮箱泄露用户阅读数据/长期记忆/聊天摘要，并暴露系统提示词；
//       而后台「保存」在线上本就因 Vercel 只读文件系统失效，屏蔽不损失任何实际功能。
// process.env.VERCEL 在所有 Vercel 部署中为 "1"，本地 dev / next start 下为 undefined（故本地照常可用）。
import { NextResponse } from "next/server";

export function middleware() {
  if (process.env.VERCEL === "1") {
    return new NextResponse("Not Found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
