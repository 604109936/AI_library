// 内嵌预检：查目标网址的防内嵌响应头（X-Frame-Options / CSP frame-ancestors），告诉浮层"能不能 iframe"。
// 浮层打开的同时后台预检（~几百ms）：被禁 → 直接切友好落地态，用户不用对着白屏猜。预检失败按"未知"处理（走超时兜底）。
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function headOrGet(url: string): Promise<Response> {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(3500) });
    if (r.ok || (r.status >= 300 && r.status < 500)) return r;
  } catch {}
  return fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(3500) });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return NextResponse.json({ checked: false });
    const r = await headOrGet(url);
    try { r.body?.cancel(); } catch {}
    const xfo = (r.headers.get("x-frame-options") ?? "").toLowerCase();
    const csp = (r.headers.get("content-security-policy") ?? "").toLowerCase();
    const faMatch = csp.match(/frame-ancestors\s+([^;]+)/);
    const blockedByCsp = !!faMatch && !faMatch[1].includes("*");
    const blocked = xfo.includes("deny") || xfo.includes("sameorigin") || blockedByCsp;
    return NextResponse.json({ checked: true, embeddable: !blocked });
  } catch {
    return NextResponse.json({ checked: false }); // 预检不确定：浮层走 6s 超时兜底
  }
}
