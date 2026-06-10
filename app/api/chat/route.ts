// 智学 Agent「小涤」云函数（T2.1：一问一答打通；T2.2+ 将注入个性化变量与工具）
// 前端只发对话消息，密钥/模型细节全部留在服务端。
import { NextRequest, NextResponse } from "next/server";
import { chatOnce, type MMMessage } from "@/lib/server/minimax";

export const runtime = "nodejs";
export const maxDuration = 60;

// T2.1 临时人设（T2.2 替换为完整 System Instruction + 6 个个性化变量）
const SYSTEM = `你是「小涤」，AI 图书馆的 AI 读书伙伴。
- 你帮助用户：推荐馆藏好书、解答书中疑问、解读原文段落；与读书学习无关的问题，礼貌引导回读书话题，并自我介绍你能做什么。
- 永远用简体中文回答；用 Markdown 排版：重要观点**加粗**，引用原文用 > 引用块，列举用列表。
- 语气：懂书、亲切、克制，不堆砌套话；回答要让人有收获感。`;

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
    const content = await chatOnce([{ role: "system", content: SYSTEM }, ...msgs]);
    return NextResponse.json({ content });
  } catch (e) {
    console.error("[/api/chat]", e);
    return NextResponse.json({ error: "小涤暂时联系不上，请稍后重试" }, { status: 502 });
  }
}
