"use client";
// T6 语音输入引擎（火山豆包大模型 ASR 版）。
// 原生 SpeechRecognition 依赖 Google 语音引擎——国产安卓/微信内置浏览器普遍无此引擎，长按报
// 「找不到 Google 语音引擎」（见 docs/delivery/evidence/T6/asr-investigation.md 的历史决策）。
// 改为：本地用 Web Audio 采集 PCM → 自编码 16k 单声道 16bit WAV → POST /api/asr（服务端转火山识别）→ 回填。
// 自编码 WAV 而非用 MediaRecorder：MediaRecorder 各平台产物不一（安卓 webm/opus、iOS mp4/aac），
// 与 ASR 服务的格式要求易错配；统一成 WAV 一种格式最稳，跨安卓/iOS/微信一致。
// 仍开音量分析驱动波形动效：直接复用同一条 PCM 流算 RMS，无需另开 analyser。
// 识别是「录完再上传」的一次性流程，录音过程中没有实时文字——浮层只显示波形/计时，松手后进入「识别中」。
import { useEffect, useRef, useState } from "react";

export interface VoiceState {
  active: boolean; // 录音中
  transcribing: boolean; // 已松手、正在上传识别（浮层显示「识别中」）
  seconds: number;
  level: number; // 0~1 实时音量（驱动波形）
}

const IDLE: VoiceState = { active: false, transcribing: false, seconds: 0, level: 0 };

const TARGET_RATE = 16000; // 火山 ASR 取 16k 单声道；本地采样率（多为 44.1k/48k）会降采样到此
const MAX_SECONDS = 60; // 超过则停止收集样本，封顶请求体大小（一句话输入远用不到）

function getAudioCtx(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  return (window.AudioContext || (window as any).webkitAudioContext) ?? null;
}

export function voiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!navigator.mediaDevices?.getUserMedia && !!getAudioCtx();
}

export function useVoiceInput() {
  const [state, setState] = useState<VoiceState>(IDLE);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const srcRateRef = useRef(TARGET_RATE);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const fatalRef = useRef(false); // 权限被拒/无麦克风：松手时给正确引导而非「没听清」
  const recordingRef = useRef(false);
  const sessionRef = useRef(0); // 代际校验：权限未决期「松手→再长按」时让晚到的 getUserMedia 自废，绝不挂到新会话

  useEffect(() => () => { cleanup(); }, []); // 卸载兜底释放

  function cleanup() {
    recordingRef.current = false;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { procRef.current?.disconnect(); } catch {}
    try { srcRef.current?.disconnect(); } catch {}
    procRef.current = null;
    srcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    chunksRef.current = [];
  }

  /** 开始录音。返回 false = 启动失败（权限被拒/不支持等），调用方据 fatal 提示兜底 */
  async function start(): Promise<boolean> {
    cleanup(); // 防御：上一会话残留（双指竞态等）先彻底释放，绝不双流并存
    fatalRef.current = false;
    chunksRef.current = [];
    startedAt.current = Date.now();
    const session = ++sessionRef.current;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      fatalRef.current = true; // 权限被拒 / 无麦克风
      return false;
    }
    // 启动期间已被新会话或取消顶替：释放刚拿到的流、放弃，绝不挂到当前会话（否则旧 tracks 永不释放、麦灯常亮）
    if (session !== sessionRef.current) { stream.getTracks().forEach((t) => t.stop()); return false; }

    try {
      const Ctx = getAudioCtx()!;
      const ctx = new Ctx();
      // iOS 上 AudioContext 可能以 suspended 创建（非直接手势栈内）：不 resume 则采不到样本
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      ctxRef.current = ctx;
      srcRateRef.current = ctx.sampleRate;
      const src = ctx.createMediaStreamSource(stream);
      srcRef.current = src;
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      let lastLevelAt = 0;
      proc.onaudioprocess = (e) => {
        if (!recordingRef.current) return;
        const input = e.inputBuffer.getChannelData(0);
        // 封顶时长：超过后只更新动效、不再收样本，避免请求体无限增大
        if ((Date.now() - startedAt.current) / 1000 <= MAX_SECONDS) {
          chunksRef.current.push(new Float32Array(input)); // 必须拷贝：inputBuffer 会被复用
        }
        // 实时音量（RMS）→ 节流 ~10fps 更新（每帧 setState 会驱动整页上百条消息重渲染）
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const level = Math.min(1, Math.sqrt(sum / input.length) * 3.2);
        const now = performance.now();
        if (now - lastLevelAt > 100) {
          lastLevelAt = now;
          setState((s) => (s.active ? { ...s, level } : s));
        }
      };
      src.connect(proc);
      proc.connect(ctx.destination); // 部分浏览器需接 destination 才触发 onaudioprocess；不写 output → 静音，无回授
      streamRef.current = stream;
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      cleanup();
      return false;
    }

    recordingRef.current = true;
    setState({ active: true, transcribing: false, seconds: 0, level: 0 });
    timerRef.current = setInterval(() => {
      setState((s) => (s.active ? { ...s, seconds: Math.floor((Date.now() - startedAt.current) / 1000) } : s));
    }, 500);
    return true;
  }

  /**
   * 结束录音。cancel=true 丢弃；否则编码 WAV 上传 /api/asr 取识别文本。
   * 返回 Promise：text=识别结果（空=没听清/失败）；fatal=本段遇权限/麦克风致命错误；error=网络/服务端识别失败。
   */
  async function stop(cancel: boolean): Promise<{ text: string; fatal: boolean; error?: boolean; soft?: boolean }> {
    const fatal = fatalRef.current;
    recordingRef.current = false;
    sessionRef.current++; // 作废本会话：兜底让任何在途回调失效
    const durationSec = (Date.now() - startedAt.current) / 1000;
    const collected = cancel ? [] : chunksRef.current.slice(); // 先取走样本，cleanup 会清空 chunks
    const srcRate = srcRateRef.current;
    cleanup();

    if (cancel || fatal) { setState(IDLE); return { text: "", fatal }; }
    const totalLen = collected.reduce((n, c) => n + c.length, 0);
    if (totalLen === 0 || durationSec < 0.3) { setState(IDLE); return { text: "", fatal: false }; } // 太短=没说话

    const wav = encodeWav(collected, srcRate, TARGET_RATE);
    setState({ active: false, transcribing: true, seconds: 0, level: 0 });
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 35_000); // 安全网：后端最长约 25s，超 35s 判失败，绝不让「识别中」卡死
    try {
      const res = await fetch("/api/asr", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav, signal: ctrl.signal });
      const data = await res.json().catch(() => null);
      setState(IDLE);
      if (!res.ok || !data) return { text: "", fatal: false, error: true };
      return { text: String(data.text ?? "").trim(), fatal: false };
    } catch {
      setState(IDLE);
      return { text: "", fatal: false, error: true };
    } finally {
      clearTimeout(to);
    }
  }

  return { voice: state, startVoice: start, stopVoice: stop };
}

// ===== WAV 编码（16k 单声道 16bit PCM）=====

function encodeWav(chunks: Float32Array[], srcRate: number, dstRate: number): Blob {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  const down = downsample(merged, srcRate, dstRate);

  const buf = new ArrayBuffer(44 + down.length * 2);
  const view = new DataView(buf);
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + down.length * 2, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk 大小
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, dstRate, true);
  view.setUint32(28, dstRate * 2, true); // 字节率 = rate * 声道 * 位深/8
  view.setUint16(32, 2, true); // 块对齐 = 声道 * 位深/8
  view.setUint16(34, 16, true); // 位深
  writeStr(view, 36, "data");
  view.setUint32(40, down.length * 2, true);
  let o = 44;
  for (let i = 0; i < down.length; i++) {
    const s = Math.max(-1, Math.min(1, down[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

// 降采样到目标采样率：按比例分段取均值（抗混叠的廉价做法，对语音识别足够）
function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buf;
  const ratio = from / to;
  const newLen = Math.round(buf.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const start = Math.round(i * ratio);
    const end = Math.min(Math.round((i + 1) * ratio), buf.length);
    let sum = 0;
    let cnt = 0;
    for (let j = start; j < end; j++) { sum += buf[j]; cnt++; }
    result[i] = cnt ? sum / cnt : 0;
  }
  return result;
}

function writeStr(v: DataView, off: number, s: string) {
  for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
}
