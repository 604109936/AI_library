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
  const fatalRef = useRef(false); // 权限被拒/无麦克风等致命错误：停止续录，松手时给正确引导而非"没听清"

  useEffect(() => () => { cleanup(); }, []); // 卸载兜底释放

  function cleanup() {
    // 先置 null 再 stop：stop 会触发 onend，置空在前才能让 onend 的"仍在录音则续录"判定不误重启
    const rec = recRef.current;
    recRef.current = null;
    try { rec?.stop(); } catch {}
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
    cleanup(); // 防御：上一会话未正常结束（双指竞态等）时先停旧识别器/旧流，绝不双识别器并存
    finalRef.current = "";
    interimRef.current = "";
    fatalRef.current = false;
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
      // no-speech 等非致命错误：不打断录音 UI，松手时按已识别文本处理。
      // 但 not-allowed（权限拒绝是异步报错，rec.start() 不抛）/audio-capture（无麦克风）是致命错误：
      // 必须置 fatal 阻断 onend 续录——否则 start→error→end→start 无限空转，浮层还在"假装听"
      rec.onerror = (e: any) => {
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed" || e?.error === "audio-capture") {
          fatalRef.current = true;
        }
      };
      // 部分平台（iOS Safari 等）识别会在静音/超时后自行 end：仍在录音态则续录（finalRef 保留已定稿文本），
      // 否则用户后面说的话全部丢失而浮层还在"假装听"。主动 stop 时 recRef 已被 cleanup 置空，不会误重启
      rec.onend = () => {
        if (recRef.current !== rec || fatalRef.current) return;
        try { rec.start(); } catch { /* 无法续录：保留已识别文本，等用户松手 */ }
      };
      rec.start();
      recRef.current = rec;
      // 音量分析：完全异步启动，绝不 await——getUserMedia 在权限未决时会无限挂起，
      // 阻塞会卡死整个录音浮层；拿不到流就让波形走匀速呼吸回退（level 恒 -1）。
      // 回调必须做代际校验（recRef === rec）：权限未决期"松手→再长按"会让旧流晚到，
      // 不校验会把旧流挂上新会话、旧 tracks 永不释放（麦克风指示灯常亮）
      navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => {
          if (recRef.current !== rec) { stream.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current?.getTracks().forEach((t) => t.stop()); // 防覆盖泄漏
          ctxRef.current?.close().catch(() => {});
          streamRef.current = stream;
          const ctx = new AudioContext();
          ctxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);
          let lastSet = 0;
          const tick = () => {
            analyser.getByteFrequencyData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i];
            const level = Math.min(1, sum / buf.length / 96);
            // 节流到 ~10fps：每帧 setState 会驱动整页（含上百条消息）60fps 重渲染
            const now = performance.now();
            if (now - lastSet > 100) {
              lastSet = now;
              setState((s) => (s.active ? { ...s, level } : s));
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        })
        .catch(() => { /* 无麦克风音量流：波形走匀速呼吸 */ });
    } catch {
      return false;
    }
    setState({ active: true, seconds: 0, level: -1, text: "" });
    timerRef.current = setInterval(() => {
      setState((s) => (s.active ? { ...s, seconds: Math.floor((Date.now() - startedAt.current) / 1000) } : s));
    }, 500);
    return true;
  }

  /** 结束录音。cancel=true 丢弃；fatal=true 表示本段录音遇到权限拒绝/无麦克风（调用方给正确引导） */
  function stop(cancel: boolean): { text: string; fatal: boolean } {
    const text = cancel ? "" : (finalRef.current + interimRef.current).trim();
    const fatal = fatalRef.current;
    cleanup();
    setState(IDLE);
    return { text, fatal };
  }

  return { voice: state, startVoice: start, stopVoice: stop };
}
