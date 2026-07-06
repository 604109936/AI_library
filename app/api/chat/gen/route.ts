// 断线恢复端点：客户端跳去看来源网页被冻结、回来后凭 genId 取回服务端后台继续生成的进度/终稿。
// genId 是客户端生成的不可猜 UUID（能力凭证）——无需登录态，游客也能恢复；行由 /api/chat 写入、15 分钟 TTL 清理。
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server/agent";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ found: false });
  const { data, error } = await admin.from("chat_gens").select("content,events,done").eq("id", id).maybeSingle();
  if (error || !data) { console.info("[gen-get]", id.slice(0, 8), "notfound"); return NextResponse.json({ found: false }); }
  console.info("[gen-get]", id.slice(0, 8), "done=" + !!data.done, "len=" + String(data.content ?? "").length);
  return NextResponse.json({ found: true, done: !!data.done, content: data.content ?? "", events: Array.isArray(data.events) ? data.events : [] });
}

// 客户端恢复链路埋点收口（fire-and-forget beacon）：复现一次断线即可在 vercel logs 还原每一步
export async function POST(req: NextRequest) {
  try {
    const j = await req.json();
    const id = String(j?.id ?? "").slice(0, 8);
    const step = String(j?.step ?? "").slice(0, 60);
    if (id && step) console.info("[gen-beacon]", id, step);
  } catch {}
  return NextResponse.json({ ok: true });
}
