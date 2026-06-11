"use client";
// T6 语音输入引擎。识别走浏览器原生 SpeechRecognition——MiniMax 实测无 ASR 服务
// （文档索引/候选端点/多模态输入三层核实，见 docs/delivery/evidence/T6/asr-investigation.md），
// 第三方 ASR 需新增密钥违背零人工介入，故选原生方案：iOS Safari 14.5+（Siri 后端，国内可用）、
// 桌面 Chrome/Edge 支持；微信内置等不支持的环境由调用方降级提示。
// 另开 getUserMedia 流做音量分析（驱动波形动效）；音量流失败不阻断识别（动效退化为匀速呼吸）。
// E2E 钩子：window.__AIL_SR 存在时优先使用（无头环境注入 mock 引擎验证交互全链路）。
import { useEffect, useRef, useState } from "react";

export interface VoiceState {
  active: boolean;
  seconds: number;
  level: number; // 0~1 实时音量（无音量流时为 -1，UI 走匀速呼吸回退）
  text: string; // 实时识别文本（已定稿 + 候选）
}

const IDLE: VoiceState = { active: false, seconds: 0, level: 0, text: "" };

function getSR(): (new () => any) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.__AIL_SR ?? w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupported(): boolean {
  return !!getSR();
}

export function useVoiceInput() {
  const [state, setState] = useState<VoiceState>(IDLE);
  const recRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalRef = useRef("");
  const interimRef = useRef("");
  const startedAt = useRef(0);

  useEffect(() => () => { cleanup(); }, []); // 卸载兜底释放

  function cleanup() {
    try { recRef.current?.stop(); } catch {}
    recRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }

  /** 开始录音识别。返回 false = 启动失败（权限被拒等），调用方提示兜底 */
  async function start(): Promise<boolean> {
    const SR = getSR();
    if (!SR) return false;
    finalRef.current = "";
    interimRef.current = "";
    startedAt.current = Date.now();
    try {
      const rec = new SR();
      rec.lang = "zh-CN";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalRef.current += r[0]?.transcript ?? "";
          else interim += r[0]?.transcript ?? "";
        }
        interimRef.current = interim;
        setState((s) => (s.active ? { ...s, text: finalRef.current + interimRef.current } : s));
      };
      rec.onerror = () => {}; // no-speech 等非致命错误：不打断录音 UI，松手时按已识别文本处理
      rec.start();
      recRef.current = rec;
    } catch {
      return false;
    }
    setState({ active: true, seconds: 0, level: -1, text: "" });
    timerRef.current = setInterval(() => {
      setState((s) => (s.active ? { ...s, seconds: Math.floor((Date.now() - startedAt.current) / 1000) } : s));
    }, 500);
    // 音量分析：完全异步启动，绝不 await——getUserMedia 在权限未决时会无限挂起，
    // 阻塞会卡死整个录音浮层；拿不到流就让波形走匀速呼吸回退（level 恒 -1）
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        if (!recRef.current) { stream.getTracks().forEach((t) => t.stop()); return; } // 流到达时已松手
        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i];
          const level = Math.min(1, sum / buf.length / 96);
          setState((s) => (s.active ? { ...s, level } : s));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => { /* 无麦克风音量流：波形走匀速呼吸 */ });
    return true;
  }

  /** 结束录音。cancel=true 丢弃；否则返回识别文本（定稿 + 残余候选） */
  function stop(cancel: boolean): string {
    const text = cancel ? "" : (finalRef.current + interimRef.current).trim();
    cleanup();
    setState(IDLE);
    return text;
  }

  return { voice: state, startVoice: start, stopVoice: stop };
}
