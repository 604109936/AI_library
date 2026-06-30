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
const CHUNK_MS = 200; // 每 200ms 发一包 PCM

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
  const sessionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const donePromise = useRef<{ resolve: (t: string) => void } | null>(null);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    recordingRef.current = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { procRef.current?.disconnect(); } catch {}
    try { srcRef.current?.disconnect(); } catch {}
    procRef.current = null; srcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
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

  /** 开始：建 WS + 采音。返回 false=启动失败（权限/不支持/连接失败）。 */
  async function start(): Promise<boolean> {
    cleanup();
    fatalRef.current = false;
    finalText.current = ""; pcmBuf.current = [];
    startedAt.current = Date.now();
    const session = ++sessionRef.current;
    const wsUrl = streamWsUrl();
    if (!wsUrl) return false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch { fatalRef.current = true; return false; }
    if (session !== sessionRef.current) { stream.getTracks().forEach((t) => t.stop()); return false; }

    setState({ ...IDLE, transcribing: true });
    // 建 WS（带 Origin 由浏览器自动加；可附 token query 备未来鉴权）
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    const wsReady = new Promise<boolean>((resolve) => {
      let settled = false;
      ws.onopen = () => { if (!settled) { settled = true; resolve(true); } };
      ws.onerror = () => { if (!settled) { settled = true; resolve(false); } };
      ws.onclose = () => { if (!settled) { settled = true; resolve(false); } };
      setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 6000);
    });
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
        donePromise.current?.resolve(finalText.current.trim()); donePromise.current = null;
      }
    };
    const ok = await wsReady;
    if (!ok || session !== sessionRef.current) { stream.getTracks().forEach((t) => t.stop()); try { ws.close(); } catch {} return false; }

    // 起采音
    try {
      const Ctx = getAudioCtx()!;
      const ctx = new Ctx();
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      ctxRef.current = ctx;
      const srcRate = ctx.sampleRate;
      const src = ctx.createMediaStreamSource(stream); srcRef.current = src;
      const proc = ctx.createScriptProcessor(4096, 1, 1); procRef.current = proc;
      let lastLevelAt = 0;
      proc.onaudioprocess = (e) => {
        if (!recordingRef.current) return;
        const input = e.inputBuffer.getChannelData(0);
        if ((Date.now() - startedAt.current) / 1000 <= MAX_SECONDS) { pushSamples(new Float32Array(input), srcRate); flushChunk(false); }
        let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const level = Math.min(1, Math.sqrt(sum / input.length) * 3.2);
        const now = performance.now();
        if (now - lastLevelAt > 100) { lastLevelAt = now; setState((s) => (s.active ? { ...s, level } : s)); }
      };
      src.connect(proc); proc.connect(ctx.destination);
      streamRef.current = stream;
    } catch { stream.getTracks().forEach((t) => t.stop()); cleanup(); return false; }

    recordingRef.current = true;
    setState({ active: true, transcribing: false, seconds: 0, level: 0, partial: "" });
    timerRef.current = setInterval(() => setState((s) => (s.active ? { ...s, seconds: Math.floor((Date.now() - startedAt.current) / 1000) } : s)), 500);
    return true;
  }

  /** 结束。cancel=true 丢弃；否则发 EOS 等最终文本。返回 {text, fatal}。 */
  async function stop(cancel: boolean): Promise<{ text: string; fatal: boolean; error?: boolean }> {
    const fatal = fatalRef.current;
    recordingRef.current = false;
    sessionRef.current++;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (cancel || fatal) { cleanup(); setState(IDLE); return { text: "", fatal }; }

    flushChunk(true); // 把残余样本发完
    setState((s) => ({ ...s, active: false, transcribing: true }));
    // 发 EOS，等火山最终帧（带超时兜底）
    const text = await new Promise<string>((resolve) => {
      donePromise.current = { resolve };
      try { wsRef.current?.readyState === 1 ? wsRef.current.send("EOS") : resolve(finalText.current.trim()); } catch { resolve(finalText.current.trim()); }
      setTimeout(() => { donePromise.current = null; resolve(finalText.current.trim()); }, 4000);
    });
    cleanup();
    setState(IDLE);
    return { text, fatal: false, error: false };
  }

  return { voice: state, startVoice: start, stopVoice: stop };
}
