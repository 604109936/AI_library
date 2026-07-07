// 内嵌预检：查目标网址的防内嵌响应头（X-Frame-Options / CSP frame-ancestors），告诉浮层"能不能 iframe"。
// 浮层打开的同时后台预检（~几百ms）：被禁 → 直接切友好落地态，用户不用对着白屏猜。预检失败按"未知"处理（走超时兜底）。
// 安全：本端点匿名可达且会替调用方向任意 URL 发请求，必须防 SSRF——解析目标 IP 拒绝内网/回环/云元数据地址，
//       重定向手动逐跳复检（防「外部 URL 302 跳内网」绕过）。
import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import net from "node:net";

export const runtime = "nodejs";

// 私有 / 回环 / 链路本地 / 保留网段：命中即拒绝（防 SSRF 探测内网主机与云元数据 169.254.169.254）
function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((x) => Number.isNaN(x) || x < 0 || x > 255)) return true;
    const [a, b] = p;
    if (a === 10 || a === 127 || a === 0) return true;                 // 私有 / 回环 / 本网
    if (a === 172 && b >= 16 && b <= 31) return true;                  // 私有
    if (a === 192 && b === 168) return true;                           // 私有
    if (a === 169 && b === 254) return true;                           // 链路本地（含云元数据）
    if (a === 100 && b >= 64 && b <= 127) return true;                 // CGNAT
    if (a >= 224) return true;                                         // 组播 / 保留
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true;                        // 回环 / 未指定
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true; // 链路本地 / ULA
    // IPv4-mapped（::ffff:a.b.c.d）取出内层再判
    const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  return true; // 非法 IP：拒绝
}

// 域名解析出的所有 A/AAAA 记录任一命中内网即拒绝（含 DNS rebinding 的第一道防线）
async function hostSafe(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return false;
  if (net.isIP(h)) return !isBlockedIp(h); // 直接给 IP 字面量
  try {
    const recs = await lookup(hostname, { all: true });
    if (!recs.length) return false;
    return recs.every((r) => !isBlockedIp(r.address));
  } catch { return false; }
}

// 手动跟随重定向：每一跳目标都要过 hostSafe（防外部 URL 用 302 跳内网绕过初检）。返回最终响应或 null。
async function safeFetch(startUrl: string): Promise<Response | null> {
  let url = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!(await hostSafe(u.hostname))) return null;
    let r: Response;
    try {
      r = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(3500) });
      if (!(r.status >= 300 && r.status < 400)) {
        if (r.status >= 405 || r.status === 403) { // HEAD 不被支持：改 GET 再取一次头
          try { r.body?.cancel(); } catch {}
          r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(3500) });
        }
      }
    } catch { return null; }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      try { r.body?.cancel(); } catch {}
      if (!loc) return r;
      url = new URL(loc, u).toString(); // 相对跳转补全后进入下一跳复检
      continue;
    }
    return r;
  }
  return null; // 跳数超限
}

// CSP frame-ancestors 是否禁止本站内嵌：'none' 直接禁；否则需存在裸 '*'、'self'、或匹配本站 origin 的来源才算允许，
// 否则视为被禁（旧实现只要值里含任意 '*' 子串就放行，https://*.partner.com 这类无关通配会被误判为可嵌）。
function cspBlocks(faValue: string): boolean {
  const sources = faValue.trim().split(/\s+/).filter(Boolean);
  if (!sources.length) return false;
  if (sources.some((s) => s.replace(/['"]/g, "").toLowerCase() === "none")) return true;
  const allow = sources.some((s) => {
    const t = s.replace(/['"]/g, "").toLowerCase();
    if (t === "*") return true;
    if (t === "self") return true;
    return t.includes("goodcontent.cn"); // 本站显式在白名单里
  });
  return !allow;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return NextResponse.json({ checked: false });
    const r = await safeFetch(url);
    if (!r) return NextResponse.json({ checked: false }); // 被内网防护拦下 / 无法访问：按未知处理，浮层走超时兜底
    try { r.body?.cancel(); } catch {}
    const xfo = (r.headers.get("x-frame-options") ?? "").toLowerCase();
    const csp = (r.headers.get("content-security-policy") ?? "").toLowerCase();
    const faMatch = csp.match(/frame-ancestors\s+([^;]+)/);
    const blockedByCsp = !!faMatch && cspBlocks(faMatch[1]);
    const blocked = xfo.includes("deny") || xfo.includes("sameorigin") || xfo.includes("allow-from") || blockedByCsp;
    return NextResponse.json({ checked: true, embeddable: !blocked });
  } catch {
    return NextResponse.json({ checked: false }); // 预检不确定：浮层走 6s 超时兜底
  }
}
