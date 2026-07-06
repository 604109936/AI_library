// 断线恢复端点：客户端跳去看来源网页被冻结、回来后凭 genId 取回服务端后台继续生成的进度/终稿。
// genId 是客户端生成的不可猜 UUID（能力凭证）——无需登录态，游客也能恢复；行由 /api/chat 写入、15 分钟 TTL 清理。
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server/agent";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ found: false });
  const { data, error } = await admin.from("chat_gens").select("content,events,done").eq("id", id).maybeSingle();
  if (error || !data) return NextResponse.json({ found: false });
  return NextResponse.json({ found: true, done: !!data.done, content: data.content ?? "", events: Array.isArray(data.events) ? data.events : [] });
}
