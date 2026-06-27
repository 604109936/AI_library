// T6 语音识别接口：前端长按说话录成 16k 单声道 WAV → POST 本接口 → 火山豆包大模型 ASR → 返回文字。
// 仅服务端持有火山密钥（VOLC_ASR_*），前端永不接触。识别细节封装在 lib/server/asr.ts。
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getUid } from "@/lib/server/agent";
import { rateLimit, limiterKey } from "@/lib/server/ratelimit";
import { transcribeWav, asrConfigured } from "@/lib/server/asr";

export const runtime = "nodejs";
export const maxDuration = 30; // 提交+轮询；短语音通常数秒内出，给足余量

const MAX_BYTES = 2_000_000; // 60s 的 16k/16bit 单声道 WAV 约 1.9MB，封顶防滥用烧钱

export async function POST(req: NextRequest) {
  if (!asrConfigured()) {
    // 未配置密钥：明确告知，前端据此降级提示（而非"没听清"误导）
    return NextResponse.json({ error: "语音识别未配置" }, { status: 503 });
  }
  // 限流（计费路径，防脚本滥刷）：登录 30/分·300/时；游客按 IP 收紧到 12/分·60/时
  const uid = await getUid(req.headers.get("authorization"));
  const lk = limiterKey(uid, req.headers.get("x-forwarded-for"));
  const [perMin, perHour] = uid ? [30, 300] : [12, 60];
  const [okMin, okHour] = await Promise.all([
    rateLimit(`asrm:${lk}`, perMin, 60_000),
    rateLimit(`asrh:${lk}`, perHour, 3_600_000),
  ]);
  if (!okMin || !okHour) {
    return NextResponse.json({ error: "语音识别太频繁了，歇一会儿再试" }, { status: 429 });
  }

  let wav: ArrayBuffer;
  try {
    wav = await req.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "音频读取失败" }, { status: 400 });
  }
  if (!wav.byteLength) return NextResponse.json({ error: "音频为空" }, { status: 400 });
  if (wav.byteLength > MAX_BYTES) return NextResponse.json({ error: "录音太长了" }, { status: 413 });

  try {
    const text = await transcribeWav(wav);
    return NextResponse.json({ text });
  } catch (e) {
    console.error("[asr] 识别失败:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "识别失败" }, { status: 502 });
  }
}
