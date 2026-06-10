// 智学 Agent「小涤」云函数（T2.2：完整人设 + 馆藏书单 + 读者个人数据注入）
// 前端只发对话消息（登录态附带 Supabase token），密钥/模型/数据组装全部留在服务端。
import { NextRequest, NextResponse } from "next/server";
import { chatOnce, type MMMessage } from "@/lib/server/minimax";
import { buildSystem, getUid } from "@/lib/server/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TURNS = 20; // 上下文裁剪（T2.6 做压缩前的简单上限）
const MAX_CHARS = 4000; // 单条消息长度护栏

export async function POST(req: NextRequest) {
  let body: { messages?: { role?: string; content?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const msgs: MMMessage[] = raw
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content!.slice(0, MAX_CHARS) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
    return NextResponse.json({ error: "缺少用户消息" }, { status: 400 });
  }

  try {
    const uid = await getUid(req.headers.get("authorization"));
    const system = await buildSystem(uid);
    const content = await chatOnce([{ role: "system", content: system }, ...msgs]);
    return NextResponse.json({ content });
  } catch (e) {
    console.error("[/api/chat]", e);
    return NextResponse.json({ error: "小涤暂时联系不上，请稍后重试" }, { status: 502 });
  }
}
