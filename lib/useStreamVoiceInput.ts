"use client";
// 流式语音输入（实时版）：录音过程中边采集 PCM 边经 Supabase Edge Function 中继给火山大模型流式 ASR，
// 实时拿到识别文字（边说边出字）。松手时文字基本已就绪 → 几乎立刻可发送，没有「…」长等待。
// 与一次性版（useVoiceInput.ts，文件识别）并存：通过 NEXT_PUBLIC_ASR_STREAM 开关切换，便于回退。
import { useEffect, useRef, useState } from "react";

export interface StreamVoiceState {
  active: boolean;       // 录音中
  transcribing: boolean;   // WS 连接/握手中
  seconds: number;
  level: number;         // 0~1 实时音量（驱动波形）
  partial: string;       // 实时识别文本（中间+已定稿拼接，供录音面板边说边显）
}
const IDLE: StreamVoiceState = { active: false, transcribing: false, seconds: 0, level: 0, partial: "" };
const TARGET_RATE = 16000;
const MAX_SECONDS = 60;
const CHUNK_MS = 100; // 每 100ms 发一包 PCM（越小实时识别延迟越低）

function getAudioCtx(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  return (window.AudioContext || (window as any).webkitAudioContext) ?? null;
}
export function streamVoiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!navigator.mediaDevices?.getUserMedia && !!getAudioCtx() && !!streamWsUrl();
}
// 由 NEXT_PUBLIC_SUPABASE_URL 推出 Edge Function 的 wss 地址：https://<ref>.supabase.co → wss://<ref>.supabase.co/functions/v1/asr-stream
function streamWsUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const u = new URL(base);
    return `wss://${u.host}/functions/v1/asr-stream`;
  } catch { return null; }
}

// 预热中继：进聊天页 / 露出语音意图时，先用一次 HTTP GET 把 Edge Function 的 isolate 焐热（启动 + 加载 npm:ws），
// 这样"第一次真正录音"不再撞 isolate 冷启动（1~2s）——根治"刚授权后第一次长按因冷启动识别不出，第二次才好"。
// 节流：30s 内最多一次（够覆盖冷却窗口，又不刷请求）。GET 非 WS 会被函数回 400，但目的只是把 isolate 跑起来。
let lastPrewarmAt = 0;
export function prewarmStreamAsr(): void {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || typeof fetch === "undefined") return;
  const now = Date.now();
  if (now - lastPrewarmAt < 30_000) return;
  lastPrewarmAt = now;
  try { fetch(`${base}/functions/v1/asr-stream`, { method: "GET", mode: "no-cors", cache: "no-store" }).catch(() => {}); } catch {}
}

export function useStreamVoiceInput() {
  const [state, setState] = useState<StreamVoiceState>(IDLE);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const startedAt = useRef(0);
  const recordingRef = useRef(false);
  const fatalRef = useRef(false);
  const pcmBuf = useRef<number[]>([]);   // 累积的 16k Int16 待发样本
  const finalText = useRef("");          // 最新完整识别文本（result_type=full）
  const wsFailedRef = useRef(false);     // WS 连接失败（用于 stop 兜底给「网络不顺」提示）
  const sessionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const donePromise = useRef<{ resolve: (t: string) => void } | null>(null);
  const preArmed = useRef(false); // 预拾音已启动（pointerdown 即开麦+连WS，长按判定通过后无缝转正——根治"开口早于拾音"丢字）
  const bootP = useRef<Promise<boolean> | null>(null);

  // 卸载时才彻底拆（含关 AudioContext）；录音之间的 cleanup 保留 ctx 常热（见 cleanup 注释）
  useEffect(() => () => { cleanup(); try { ctxRef.current?.close(); } catch {} ctxRef.current = null; }, []);

  // 创建 / resume 持久 AudioContext，并保持常热复用。在用户手势里（pointerdown）提前调用预热，
  // 这样真正录音时瞬间起采、不丢前半句；首次也因已提前 resume 而无静音空档。resume 需用户手势触发。
  function warmAudio() {
    try {
      let ctx = ctxRef.current;
      if (!ctx || ctx.state === "closed") { const Ctx = getAudioCtx(); if (!Ctx) return; ctx = new Ctx(); ctxRef.current = ctx; }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
    } catch {}
  }

  function cleanup() {
    recordingRef.current = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { procRef.current?.disconnect(); } catch {}
    try { srcRef.current?.disconnect(); } catch {}
    procRef.current = null; srcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // 关键：不关 AudioContext——保持常热复用。每次松手都关、下次按再新建+resume 会拖慢录音起点、
    // 丢掉前半句（正是"整体变慢、说完松手识别不出"的回退根因）。ctx 仅在组件卸载时关。
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    pcmBuf.current = [];
  }

  // 把 Float32（源采样率）线性重采样到 16k，并量化成 Int16，追加进 pcmBuf
  function pushSamples(input: Float32Array, srcRate: number) {
    const ratio = srcRate / TARGET_RATE;
    const outLen = Math.floor(input.length / ratio);
    for (let i = 0; i < outLen; i++) {
      const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
      pcmBuf.current.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }
  }
  // 取出累积的样本打成一个 Int16 ArrayBuffer 发出去
  function flushChunk(force = false) {
    const need = TARGET_RATE * CHUNK_MS / 1000;
    if (pcmBuf.current.length < need && !force) return;
    if (!pcmBuf.current.length) return;
    const take = force ? pcmBuf.current.length : Math.floor(pcmBuf.current.length / need) * need;
    const slice = pcmBuf.current.splice(0, take);
    const buf = new ArrayBuffer(slice.length * 2);
    const dv = new DataView(buf);
    for (let i = 0; i < slice.length; i++) dv.setInt16(i * 2, slice[i] | 0, true);
    try { wsRef.current?.readyState === 1 && wsRef.current.send(buf); } catch {}
  }

  // 正式进入录音态（拾音/WS 已就绪）：置位 + UI 状态 + 计时
  function arm() {
    preArmed.current = false;
    recordingRef.current = true;
    startedAt.current = Date.now(); // MAX_SECONDS 从正式录音起算（预拾音的几百毫秒不占额度）
    setState({ active: true, transcribing: false, seconds: 0, level: 0, partial: "" });
    timerRef.current = setInterval(() => setState((s) => (s.active ? { ...s, seconds: Math.floor((Date.now() - startedAt.current) / 1000) } : s)), 500);
  }
  /** 预拾音（pointerdown 即调）：开麦 + 连 WS + 采音进缓冲，但不进录音 UI。长按判定通过后 start() 无缝转正；
   *  判定为点按则 cancelPre() 立刻关麦丢弃（橙点仅闪现，未录任何内容被保留）。 */
  function preCapture() {
    if (preArmed.current || recordingRef.current) return;
    preArmed.current = true;
    bootP.current = boot().then((ok) => { if (!ok) preArmed.current = false; return ok; });
  }
  /** 取消预拾音（快速点按想打字）：立刻关麦、断 WS、清缓冲 */
  function cancelPre() {
    if (!preArmed.current || recordingRef.current) return;
    preArmed.current = false;
    sessionRef.current++; // 打断在途 boot
    cleanup();
  }
  /** 开始：预拾音已就绪则无缝转正；否则现场启动。返回 false=启动失败。 */
  async function start(): Promise<boolean> {
    if (preArmed.current && bootP.current) {
      const ok = await bootP.current;
      if (ok && streamRef.current) { arm(); return true; }
      preArmed.current = false; // 预启动失败：走全新启动
    }
    const ok = await boot();
    if (!ok) return false;
    arm();
    return true;
  }
  async function boot(): Promise<boolean> {
    cleanup();
    fatalRef.current = false; wsFailedRef.current = false;
    finalText.current = ""; pcmBuf.current = [];
    startedAt.current = Date.now();
    const session = ++sessionRef.current;
    const wsUrl = streamWsUrl();
    if (!wsUrl) return false;

    // ① WS 先拨出去并行连——**不 await**，所以录音面板不必等握手（冷启动 1~2s）就能立刻弹出。
    //    onaudioprocess 持续把 PCM 进缓冲，flushChunk 只在 ws 真正 OPEN 后才发，所以握手期间的音频不丢、连上即补发。
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    ws.onerror = () => { wsFailedRef.current = true; };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let m: any; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "result") {
        // result_type=full：每帧 m.text 即当前完整识别文本，直接覆盖显示（边说边出字、不累积、不重复）
        if (typeof m.text === "string") finalText.current = m.text;
        if (recordingRef.current) setState((s) => ({ ...s, partial: finalText.current }));
      } else if (m.type === "done") {
        const t = ((m.text && m.text.trim()) ? m.text : finalText.current).trim();
        finalText.current = t; donePromise.current?.resolve(t); donePromise.current = null;
      } else if (m.type === "error") {
        wsFailedRef.current = !finalText.current;
        donePromise.current?.resolve(finalText.current.trim()); donePromise.current = null;
      }
    };

    // ② 拿麦克风（唯一必须 await 的步骤；权限已授时很快）
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch { fatalRef.current = true; try { ws.close(); } catch {} return false; }
    if (session !== sessionRef.current) { stream.getTracks().forEach((t) => t.stop()); try { ws.close(); } catch {} return false; }

    // ③ 立刻起采音（复用常热的持久 ctx，不 await resume——多已被 warmAudio(pointerdown) 提前焐热，瞬间起采、不丢前半句）
    try {
      let ctx = ctxRef.current;
      if (!ctx || ctx.state === "closed") { const Ctx = getAudioCtx()!; ctx = new Ctx(); ctxRef.current = ctx; }
      if (ctx.state === "suspended") ctx.resume().catch(() => {}); // fire-and-forget：绝不阻塞录音起点
      const srcRate = ctx.sampleRate;
      const src = ctx.createMediaStreamSource(stream); srcRef.current = src;
      const proc = ctx.createScriptProcessor(4096, 1, 1); procRef.current = proc;
      let lastLevelAt = 0;
      proc.onaudioprocess = (e) => {
        if (!recordingRef.current && !preArmed.current) return;
        const input = e.inputBuffer.getChannelData(0);
        if ((Date.now() - startedAt.current) / 1000 <= MAX_SECONDS) { pushSamples(new Float32Array(input), srcRate); flushChunk(false); }
        let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const level = Math.min(1, Math.sqrt(sum / input.length) * 3.2);
        const now = performance.now();
        if (recordingRef.current && now - lastLevelAt > 100) { lastLevelAt = now; setState((s) => (s.active ? { ...s, level } : s)); }
      };
      src.connect(proc); proc.connect(ctx.destination);
      streamRef.current = stream;
    } catch { stream.getTracks().forEach((t) => t.stop()); cleanup(); return false; }

    return true; // 拾音/WS 已跑起来；进录音 UI 由 arm() 负责
  }

  /** 结束。cancel=true 丢弃；否则发 EOS 等最终文本。返回 {text, fatal}。 */
  async function stop(cancel: boolean): Promise<{ text: string; fatal: boolean; error?: boolean }> {
    const fatal = fatalRef.current;
    preArmed.current = false;
    recordingRef.current = false;
    sessionRef.current++;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (cancel || fatal) { cleanup(); setState(IDLE); return { text: "", fatal }; }

    setState((s) => ({ ...s, active: false, transcribing: true }));
    const ws = wsRef.current;
    // 把「残余缓存音频 + EOS」发给中继。关键：WS 还在连（冷启动首按最常见）时绝不能立刻判空返回，
    // 否则这次说的话全丢——要挂到 onopen，等连上再补发，这样第一次长按也能识别。
    const sendTail = () => { flushChunk(true); try { ws?.send("EOS"); } catch {} };
    const text = await new Promise<string>((resolve) => {
      donePromise.current = { resolve };
      if (ws && ws.readyState === 1) sendTail();             // 已连上：直接发
      else if (ws && ws.readyState === 0) ws.addEventListener("open", sendTail, { once: true }); // 还在连：等连上补发
      else { resolve(finalText.current.trim()); return; }    // 已关闭/不可用：收尾
      // 正常按毫秒级就 done；冷启动「连上+火山识别」可能要几秒，给足 9s 兜底（仅异常时触发）
      // 松手秒发：实时文字(result_type=full)本就是完整句，最多再等600ms要终稿；一个字都还没出才多等一会
      setTimeout(() => { donePromise.current = null; resolve(finalText.current.trim()); }, finalText.current.trim() ? 600 : 2500);
    });
    cleanup();
    setState(IDLE);
    // 没识别出文本且 WS 曾失败 → 当作网络错误（前端提示「网络不太顺，再试一次」），而非「没听清」
    return { text, fatal: false, error: !text && wsFailedRef.current };
  }

  return { voice: state, startVoice: start, stopVoice: stop, warmAudio, preCapture, cancelPre };
}
