// T3.1 乱翻日更 Cron 入口：Vercel Cron 每天北京时间 04:00 调一次（vercel.json crons）。
// 鉴权：Vercel 配置 CRON_SECRET 环境变量后，平台会自动带 Authorization: Bearer <CRON_SECRET> 来调；
//       本地验证用 scripts/verify-flip-feed.mjs（读 .env.local 同名密钥）。
// 幂等可断点续做：生成器跳过当天已有的用户，超时被掐后再调一次即从断点继续；?force=1 强制重生成（测试用）。
import { NextRequest, NextResponse } from "next/server";
import { generateFlipFeeds } from "@/lib/server/flipfeed";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 用户量大后单次跑不完没关系：幂等续做，必要时把 Cron 频率加密

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  try {
    const stats = await generateFlipFeeds({ force: req.nextUrl.searchParams.get("force") === "1" });
    return NextResponse.json(stats);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "生成失败" }, { status: 500 });
  }
}
