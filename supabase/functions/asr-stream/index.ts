// Supabase Edge Function：浏览器 ↔ 本函数 ↔ 火山「大模型流式语音识别」的 WebSocket 中继。
// 目的：实时流式识别（边说边出字），且火山密钥只在服务端（Secrets），绝不下发浏览器。
// 架构：浏览器用「简单协议」（二进制=PCM 分片；文本 "EOS"=说完了）连本函数；
//       本函数用火山二进制帧协议连火山，把结果（中间/最终文本）以 JSON 文本回推浏览器。
// 关键点（来自调研）：
//   - 入站用 Deno.upgradeWebSocket；出站用 npm:ws（能设 X-Api-* 鉴权头，浏览器式 WS 不能设 header）。
//   - 必须 EdgeRuntime.waitUntil 保活，否则 isolate 会在 wall-clock 一半左右把连接回收。
//   - verify_jwt=false 部署（浏览器 WS 发不了 Authorization 头），用 query 里的 token 自校验。
// 部署：supabase functions deploy asr-stream --no-verify-jwt
//   secrets：supabase secrets set VOLC_ASR_APP_ID=.. VOLC_ASR_ACCESS_TOKEN=.. VOLC_ASR_STREAM_RESOURCE_ID=volc.seedasr.sauc.duration
import WebSocket from "npm:ws@8";

// 火山「豆包流式语音识别2.0」端点：bigmodel_async（异步优化双向流式），配 资源号 volc.seedasr.sauc.duration。
// 实测：该资源在 /sauc/bigmodel 报 not allowed，在 /sauc/bigmodel_async 握手通过。可由 secret / ?ep= 覆盖。
const VOLC_HOST = "wss://openspeech.bytedance.com";
const DEFAULT_EP = Deno.env.get("VOLC_ASR_STREAM_ENDPOINT") || "/api/v3/sauc/bigmodel_async";
const APP_ID = Deno.env.get("VOLC_ASR_APP_ID") ?? "";
const ACCESS = Deno.env.get("VOLC_ASR_ACCESS_TOKEN") ?? "";
const RESOURCE = Deno.env.get("VOLC_ASR_STREAM_RESOURCE_ID") ?? "volc.seedasr.sauc.duration";
// 允许的来源（轻量防滥用；非浏览器客户端可伪造 Origin，仅作第一道门，真正配额护栏靠火山自身限额）
const ALLOW_ORIGINS = (Deno.env.get("ASR_ALLOW_ORIGINS") ?? "https://www.goodcontent.cn,https://goodcontent.cn,http://localhost:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);

// ---- 火山二进制帧 ----
function buildFrame(msgType: number, flags: number, serialization: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  out[0] = 0x11; // version=1, headerSize=1(*4=4字节)
  out[1] = (msgType << 4) | flags;
  out[2] = (serialization << 4) | 0x00; // compression=none
  out[3] = 0x00;
  new DataView(out.buffer).setUint32(4, payload.length, false); // payload size, 大端
  out.set(payload, 8);
  return out;
}
function fullClientRequest(): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({
    user: { uid: "ai-library" },
    audio: { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 },
    request: { model_name: "bigmodel", enable_itn: true, enable_punc: true, show_utterances: true, result_type: "full" },
  }));
  return buildFrame(0b0001, 0b0000, 0b0001, json); // full client request, JSON
}
function audioRequest(pcm: Uint8Array, isLast: boolean): Uint8Array {
  return buildFrame(0b0010, isLast ? 0b0010 : 0b0000, 0b0000, pcm); // audio only, raw
}
function parseServer(buf: Uint8Array): { msgType: number; seq: number; obj: any } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const msgType = (buf[1] >> 4) & 0x0f;
  const seq = dv.getInt32(4, false);
  const size = dv.getUint32(8, false);
  const payload = buf.subarray(12, 12 + size);
  let obj: any = null;
  try { obj = JSON.parse(new TextDecoder().decode(payload)); } catch { /* 非 JSON（如错误帧文本）*/ obj = { _raw: new TextDecoder().decode(payload) }; }
  return { msgType, seq, obj };
}

Deno.serve((req) => {
  const url = new URL(req.url);
  const origin = req.headers.get("origin") ?? "";
  // 来源校验（WS 升级请求带 Origin；浏览器无法伪造，非浏览器客户端可伪造但要靠火山限额兜底）
  if (origin && ALLOW_ORIGINS.length && !ALLOW_ORIGINS.includes(origin)) {
    return new Response("forbidden origin", { status: 403 });
  }
  if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
    return new Response("expected websocket", { status: 400 });
  }
  if (!APP_ID || !ACCESS) return new Response("server not configured", { status: 503 });

  const { socket: client, response } = Deno.upgradeWebSocket(req);
  client.binaryType = "arraybuffer";

  let volc: WebSocket | null = null;
  let volcOpen = false;
  let closed = false;
  let eosPending = false; // 火山还没连上用户就松手了：标记，等连上后补发缓存音频 + 结束帧（别丢这次识别）
  const pending: Uint8Array[] = []; // 火山未就绪前先缓存 PCM
  let resolveDone: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  let lastText = "";   // 最新一帧的完整识别文本（result_type=full）
  let doneSent = false;
  const safeSendClient = (o: unknown) => { try { client.readyState === 1 && client.send(JSON.stringify(o)); } catch { /*noop*/ } };
  // 火山用「关闭连接」表示一段识别结束（未必发负 seq 终帧），所以 volc 关闭时也要把最终文本作为 done 回推
  const emitDone = () => { if (!doneSent) { doneSent = true; safeSendClient({ type: "done", text: lastText }); } };
  const cleanup = () => {
    if (closed) return; closed = true;
    try { volc?.close(); } catch { /*noop*/ }
    try { client.readyState === 1 && client.close(); } catch { /*noop*/ }
    resolveDone();
  };

  client.onopen = () => {
    // 连火山（端点可由 ?ep= 覆盖）
    const ep = VOLC_HOST + (url.searchParams.get("ep") || DEFAULT_EP);
    volc = new WebSocket(ep, {
      headers: {
        "X-Api-App-Key": APP_ID,
        "X-Api-Access-Key": ACCESS, // 不加 Bearer
        "X-Api-Resource-Id": url.searchParams.get("res") || RESOURCE, // 可由 query 覆盖资源号便于切换/测试
        "X-Api-Request-Id": crypto.randomUUID(),
        "X-Api-Connect-Id": crypto.randomUUID(),
      },
    });
    volc.binaryType = "arraybuffer";
    // 连接超时兜底：火山长时间连不上（冷启动异常/网络）就报错收尾，别让 isolate 一直挂到 wall-clock 上限
    const openTimer = setTimeout(() => { if (!volcOpen && !closed) { safeSendClient({ type: "error", msg: "volc 连接超时" }); cleanup(); } }, 12000);
    volc.on("open", () => {
      volcOpen = true;
      clearTimeout(openTimer);
      volc!.send(fullClientRequest());
      for (const c of pending) volc!.send(audioRequest(c, false));
      pending.length = 0;
      // 用户在火山连上前就松手了：缓存音频已补发，这里再补一个结束帧收口，让这次（第一次长按）也能识别
      if (eosPending) { try { volc!.send(audioRequest(new Uint8Array(0), true)); } catch { /*noop*/ } }
      safeSendClient({ type: "ready" });
    });
    volc.on("message", (data: ArrayBuffer | Uint8Array) => {
      const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array((data as any).buffer ?? data);
      const { msgType, seq, obj } = parseServer(buf);
      if (msgType === 0b1111) { safeSendClient({ type: "error", msg: obj?._raw || "asr error" }); cleanup(); return; }
      if (typeof obj?.result?.text === "string") lastText = obj.result.text; // result_type=full：每帧是完整累积文本
      const utts = (obj?.result?.utterances ?? []).map((u: any) => ({ text: u.text, definite: !!u.definite }));
      safeSendClient({ type: "result", text: lastText, utterances: utts, last: seq < 0 });
      if (seq < 0) { emitDone(); cleanup(); } // 负 seq = 最终帧
    });
    // 火山握手返回非 101 时，npm:ws 抛 "Unexpected server response: 400"，但真实原因在响应头/体里。
    // 抓出来转发给客户端便于诊断（X-Api-Status-Code / X-Api-Message 是火山的业务错误码）。
    volc.on("unexpected-response", (_req: any, res: any) => {
      const code = res?.statusCode;
      const apiCode = res?.headers?.["x-api-status-code"];
      const apiMsg = res?.headers?.["x-api-message"];
      let body = "";
      res?.on?.("data", (d: any) => (body += d));
      res?.on?.("end", () => { safeSendClient({ type: "error", msg: `volc握手 HTTP ${code} apiCode=${apiCode || ""} apiMsg=${apiMsg || ""} body=${body.slice(0, 160)} res=${url.searchParams.get("res") || RESOURCE}` }); cleanup(); });
      if (!res?.on) { safeSendClient({ type: "error", msg: `volc握手 HTTP ${code} (无响应体)` }); cleanup(); }
    });
    volc.on("error", (e: any) => { safeSendClient({ type: "error", msg: String(e?.message || e) }); cleanup(); });
    volc.on("close", () => { emitDone(); cleanup(); });
  };

  client.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      // 控制消息：EOS = 用户说完了，发最后一帧（空 PCM + 结束 flag）让火山收口
      if (ev.data === "EOS") {
        if (volcOpen && volc) { try { volc.send(audioRequest(new Uint8Array(0), true)); } catch { /*noop*/ } }
        else eosPending = true; // 火山还没就绪就松手：别丢！标记，等连上后补发缓存音频 + 结束帧（根治"第一次长按不识别"）
      }
      return;
    }
    // 二进制 = PCM 分片（16k/16bit/mono）
    const pcm = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(ev.data as any);
    if (volcOpen && volc) { try { volc.send(audioRequest(pcm, false)); } catch { /*noop*/ } }
    else pending.push(pcm);
  };
  client.onclose = () => cleanup();
  client.onerror = () => cleanup();

  // 保活：让 isolate 撑到连接真正结束，否则会被提前回收、WS 中途掉线
  // @ts-ignore EdgeRuntime 在 Supabase 运行时注入
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(done);
  return response;
});
