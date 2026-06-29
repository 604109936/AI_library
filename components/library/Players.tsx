"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Maximize2, Minimize2, Volume2, VolumeX, Video, Headphones, RotateCcw, RotateCw } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { formatTime } from "@/lib/utils";
import { useLibrary } from "@/lib/store";
import { useReadCountBump, useReadingClock } from "@/lib/useReadingClock";
import type { Book } from "@/lib/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function useHistoryReporter(book: Book, mode: "video" | "audio") {
  const pushHistory = useLibrary((s) => s.pushHistory);
  const setMediaProgress = useLibrary((s) => s.setMediaProgress);
  const addCoveredRegion = useLibrary((s) => s.addCoveredRegion);
  const realId = book.id.split("__")[0];
  const last = useRef(0);
  const latest = useRef({ cur: 0, dur: 0 });
  const lastT = useRef<number | null>(null);
  // 真实播放发生前不落任何账：音频 onMeta 的续播定位 seek 会触发 timeupdate，
  // 不设闸的话"打开详情页什么都不点"也会刷新历史排序、改写 lastAt 并触发 DB 写
  const armed = useRef(false);
  const arm = () => { armed.current = true; };
  // 覆盖率的「区间并集 + 跨会话持久化」已统一收进 store.addCoveredRegion——重播已覆盖段不再虚增，
  // 根治旧「base + 本会话并集/dur」跨会话反复累加致 played 虚高、误判已读完（涤生 40 分钟却 7 本全读完的 Bug）
  const write = (dur: number) => {
    if (dur <= 0 || !armed.current) return;
    // 进度=真实播放覆盖（≥90% 记 100）。音视频不写 progress（progress 专给文字稿续读/章节态，避免跨模式互相覆盖）
    const played = useLibrary.getState().mediaPlayed[realId] ?? 0;
    const prog = played >= 0.9 ? 100 : Math.round(played * 100);
    pushHistory({ bookId: realId, bookTitle: book.title, author: book.author, coverSeed: book.coverSeed, cover: book.cover, mode, progress: prog, lastAt: new Date().toISOString() });
    // 续播位置不在此写：拖动/暂停 flush 会把人为跳变位置污染进与乱翻/另一模式共享的 mediaProgress。
    // 改到 trackPlayed 的「自然前进」分支写，与乱翻同口径（Bug#8）。
  };
  const report = (cur: number, dur: number) => {
    if (!armed.current) return;
    latest.current = { cur, dur };
    const now = Date.now();
    if (now - last.current < 5000) return;
    last.current = now;
    write(dur);
  };
  const flush = () => write(latest.current.dur);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  // 覆盖区间由 store 持久化，无需会话基线；保留空函数兼容 onLoadedMetadata 的调用
  const primePlayed = (_dur: number) => {};
  // 真实播放：仅连续正常推进（增量 0~1.5s）才上报这一段；拖动/快进/loop 回卷的大跳变不计 → 排除「拖到结尾」。
  // 归一化成 0~1 区间交给 store.addCoveredRegion 做并集与持久化（重播同一段不再虚增）
  const trackPlayed = (cur: number, dur: number) => {
    if (dur > 0 && lastT.current !== null) {
      const d = cur - lastT.current;
      if (d > 0 && d < 1.5) {
        addCoveredRegion(realId, lastT.current / dur, cur / dur);
        setMediaProgress(realId, cur / dur); // 仅自然前进才写共享续播位置；拖动/快进/loop 回卷的大跳变不落（Bug#8 同口径）
      }
    }
    lastT.current = cur;
  };
  const seekReset = () => { lastT.current = null; }; // 拖动/快进后重置基准，避免把跳变误计为真实播放
  return { report, flush, trackPlayed, primePlayed, seekReset, arm };
}

/* ============================ 详情页顶部媒体台 ============================ */
export function BookMediaHero({ book, onFullscreen }: { book: Book; onFullscreen?: (fs: boolean) => void }) {
  const canVideo = book.hasVideo;
  const canAudio = book.hasAudio;
  const [mode, setMode] = useState<"video" | "audio">(canVideo ? "video" : "audio");

  if (!canVideo && !canAudio) {
    return (
      <div className="flex flex-col items-center px-4 pt-16 pb-3">
        <div className="relative">
          <BookCover title={book.title} author={book.author} seed={book.coverSeed} src={book.cover} className="w-32 shadow-2xl" />
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-gradient-to-r from-black/25 to-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 pt-16 pb-2">
      <div className="w-full max-w-[300px]">
        <div className="flex items-center justify-center">
          {mode === "video" && canVideo ? <VideoStage book={book} onFullscreen={onFullscreen} /> : <AudioStage book={book} />}
        </div>

        {canVideo && canAudio && (
          <div className="mt-3 flex justify-end">
            <div className="inline-flex rounded-full border border-line bg-snow/85 p-1 shadow-sm backdrop-blur dark:border-white/10 dark:bg-dark-card/85">
              {([["video", "视频", Video], ["audio", "音频", Headphones]] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  onClick={() => setMode(k)}
                  className={
                    "flex items-center gap-1 rounded-full px-3.5 py-1 text-xs font-medium transition " +
                    (mode === k ? "bg-celadon-soft text-celadon-700 dark:bg-celadon/25 dark:text-celadon-300" : "text-ink-500 dark:text-dark-text/60")
                  }
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- 竖屏视频 ----------------------------- */
function VideoStage({ book, onFullscreen }: { book: Book; onFullscreen?: (fs: boolean) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const getMediaProgress = useLibrary((s) => s.getMediaProgress);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const [fs, setFs] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null); // 拖动中的临时位置（松手才真正定位，不与 timeupdate 抢值）
  const [vErr, setVErr] = useState(false); // 加载/解码失败：给错误占位与重试（原来静默吞掉，看起来像 App 坏了）
  const [waiting, setWaiting] = useState(false); // 缓冲中转圈
  const resumed = useRef(false);
  const { report, flush, trackPlayed, primePlayed, seekReset, arm } = useHistoryReporter(book, "video");
  useReadingClock(playing); // 观看时长计入「我的-总时长」
  useReadCountBump(book.id.split("__")[0], playing); // 「一次阅读」计数（真实播放满30秒记一次）

  // 卸载/切台必须停声：脱离文档的媒体元素会继续播放音频且播放中不被回收——
  // 返回上页或切到音频 Tab 后声音在后台响、全 App 无任何 UI 能停（Review P0）。
  // removeAttribute+load 同时释放下载/解码资源；进度落盘由 useHistoryReporter 的卸载 flush 先行完成。
  // StrictMode(dev) 会「挂载→卸载→重挂」：cleanup 摘掉 src 后，React 因 src prop 没变不会设回 → 媒体没源、一直转圈
  // （音频/视频都中招，乱翻无此 cleanup 故不受影响）。重挂时若发现 src 被摘了就补回来；生产无 StrictMode，此分支不触发。
  useEffect(() => {
    const m = ref.current;
    if (m && !m.getAttribute("src") && book.videoUrl) { m.setAttribute("src", book.videoUrl); m.load(); }
    return () => { if (m) { m.pause(); m.removeAttribute("src"); m.load(); } };
  }, []);

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);
  // 自绘全屏：锁滚动 + 接管系统返回（压入一条历史，返回手势只退全屏不退页面）
  const fsPushed = useRef(false);
  useEffect(() => {
    if (!fs) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.history.pushState({ fs: 1 }, "");
    fsPushed.current = true;
    const onPop = () => { fsPushed.current = false; setFs(false); }; // 系统返回 → 仅退出全屏
    window.addEventListener("popstate", onPop);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("popstate", onPop);
      // 点退出按钮 / 组件卸载（非 popstate 路径）：back 一步消费掉自压入的历史，不影响后续正常返回
      if (fsPushed.current) { fsPushed.current = false; window.history.back(); }
    };
  }, [fs]);
  // 通知详情页：竖屏全屏时隐藏底部「写书评」CTA——它是 sticky z-20，会浮在全屏视频(被困在外层 z-10 上下文)之上挡视频（用户反馈）。卸载复位。
  useEffect(() => { onFullscreen?.(fs); return () => onFullscreen?.(false); }, [fs, onFullscreen]);

  // 未播放时一直显示书封（不跳到视频帧）；首次点播放才跳到上次进度
  function resumeSeek(d: number) {
    if (resumed.current || d <= 0) return;
    resumed.current = true;
    const p = getMediaProgress(book.id);
    if (p > 0 && p < 0.99 && ref.current) { ref.current.currentTime = p * d; setCur(p * d); }
  }
  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      if (!started) { setStarted(true); resumeSeek(v.duration || dur); }
      v.play().catch(() => setStarted(false));
    } else v.pause();
  }
  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }
  // 拖动只移滑块，松手才定位（与音频同方案）：原来边拖边 seek，seek 完成有延迟，
  // 拖动间隙到达的旧位置 timeupdate 会把滑块抢回去
  function commitSeek(t: number) {
    seekReset(); // 重置基准，避免把跳变算成真实播放
    setCur(t);
    if (ref.current) ref.current.currentTime = t;
    setScrub(null);
  }
  function retryLoad() {
    setVErr(false);
    setWaiting(false);
    const v = ref.current;
    if (!v) return;
    resumed.current = false; // 复位续播闸：让 load() 后的 onMeta 重新 seek 回断点（否则错误重试会从头播）
    v.load();
    if (started) v.play().catch(() => {});
  }
  function onMeta(e: React.SyntheticEvent<HTMLVideoElement>) {
    const d = e.currentTarget.duration || 0;
    setDur(d);
    primePlayed(d); // 续播覆盖累计基线
    if (started) resumeSeek(d); // 仅在已开始播放后才跳进度，避免未播放时画面从封面跳到视频帧
  }

  return (
    <div
      className={
        fs
          ? "fixed inset-y-0 left-1/2 z-[120] flex w-full max-w-app -translate-x-1/2 items-center justify-center bg-black"
          : "relative aspect-[3/4] w-full overflow-hidden rounded-3xl bg-black shadow-xl ring-1 ring-black/5 dark:ring-white/10"
      }
    >
      <video
        ref={ref}
        src={book.videoUrl}
        poster={book.cover}
        playsInline
        preload="auto"
        muted={muted}
        className="h-full w-full object-cover"
        onClick={toggle}
        onPlay={() => { arm(); setVErr(false); setPlaying(true); }}
        onPause={() => { setPlaying(false); flush(); }}
        onTimeUpdate={(e) => { const c = e.currentTarget.currentTime; const d = e.currentTarget.duration || 0; setCur(c); setWaiting(false); trackPlayed(c, d); report(c, d); }}
        onLoadedMetadata={onMeta}
        onCanPlay={() => setWaiting(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onError={() => { setVErr(true); setWaiting(false); setPlaying(false); }}
      />

      {/* 缓冲转圈：弱网断流时给"在加载"反馈（原来画面冻住零提示） */}
      {started && waiting && !vErr && (
        // 居中靠外层 translate、旋转靠内层 animate-spin：animate-spin 关键帧会写 transform 覆盖掉同元素的
        // -translate-1/2 居中，导致圈圈脱离中心上下乱跳——拆成两层即稳定居中旋转
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="block h-9 w-9 animate-spin rounded-full border-[2.5px] border-white/30 border-t-white" />
        </span>
      )}
      {/* 加载失败占位 + 重试 */}
      {vErr && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 text-snow">
          <p className="text-sm">视频加载失败</p>
          <button onClick={retryLoad} className="rounded-full bg-celadon px-5 py-2 text-xs text-snow active:scale-95">重试</button>
        </div>
      )}

      {!started && (
        <button onClick={toggle} aria-label="播放视频解读" className="absolute inset-0 flex items-center justify-center">
          {book.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={book.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-celadon/85 shadow-celadon backdrop-blur">
            <Play size={30} className="ml-1 fill-snow text-snow" />
          </span>
        </button>
      )}

      {started && !playing && (
        <button onClick={toggle} aria-label="播放" className="absolute inset-0 flex items-center justify-center bg-black/15">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-celadon/90 shadow-celadon backdrop-blur">
            <Play size={26} className="ml-1 fill-snow text-snow" />
          </span>
        </button>
      )}

      {started && (
        <div className={"absolute z-10 flex gap-1.5 " + (fs ? "right-3 top-[calc(env(safe-area-inset-top)+12px)]" : "right-2 top-2")}>
          <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "取消静音" : "静音"} className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur active:scale-90">
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          {fs ? (
            <button onClick={() => setFs(false)} aria-label="退出全屏" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur active:scale-90">
              <Minimize2 size={16} />
            </button>
          ) : (
            <button onClick={() => setFs(true)} aria-label="竖屏全屏" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur active:scale-90">
              <Maximize2 size={16} />
            </button>
          )}
        </div>
      )}

      {started && (
        <div className={"absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 text-white " + (fs ? "pb-[calc(env(safe-area-inset-bottom)+18px)] pt-12" : "pb-2 pt-6")}>
          {/* -m-3 p-3 扩触区到 ≥40px，占位与视觉不变 */}
          <button onClick={toggle} aria-label={playing ? "暂停" : "播放"} className="-m-3 shrink-0 p-3">
            {playing ? <Pause size={fs ? 20 : 16} /> : <Play size={fs ? 20 : 16} />}
          </button>
          <span className={"shrink-0 tabular-nums " + (fs ? "w-10 text-xs" : "w-8 text-[10px]")}>{formatTime(scrub ?? cur)}</span>
          <input
            type="range"
            min={0}
            max={dur || 1}
            step="any"
            value={scrub ?? cur}
            aria-label="播放进度"
            onChange={(e) => setScrub(+e.target.value)}
            onPointerUp={() => { if (scrub !== null) commitSeek(scrub); }}
            onLostPointerCapture={() => { if (scrub !== null) commitSeek(scrub); }}
            onKeyUp={() => { if (scrub !== null) commitSeek(scrub); }}
            onPointerCancel={() => setScrub(null)}
            className="h-1 flex-1 accent-celadon"
          />
          <span className={"shrink-0 tabular-nums " + (fs ? "w-10 text-xs" : "w-8 text-[10px]")}>{formatTime(dur)}</span>
          <button onClick={cycleSpeed} aria-label="倍速" className={"shrink-0 font-medium tabular-nums " + (fs ? "w-9 text-xs" : "w-7 text-[10px]")}>{speed}x</button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- 音频伴读 ----------------------------- */
function AudioStage({ book }: { book: Book }) {
  const ref = useRef<HTMLAudioElement>(null);
  const getMediaProgress = useLibrary((s) => s.getMediaProgress);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [coverOk, setCoverOk] = useState(true);
  const [scrub, setScrub] = useState<number | null>(null); // 拖动中的临时位置（松手才真正定位）
  const [aErr, setAErr] = useState(false); // 加载失败提示（原来 play().catch(()=>{}) 彻底吞掉，点了没反应像 App 坏了）
  const [waiting, setWaiting] = useState(false);
  const resumed = useRef(false);
  const { report, flush, trackPlayed, primePlayed, seekReset, arm } = useHistoryReporter(book, "audio");
  useReadingClock(playing, true); // 收听时长计入「我的-总时长」（音频：锁屏/切后台也计，伴读核心场景）
  useReadCountBump(book.id.split("__")[0], playing, true); // 「一次阅读」计数（音频后台也累计满 30 秒记一次）

  // 卸载/切台停声 + 释放资源（与 VideoStage 同口径，Review P0）。
  // StrictMode(dev) 重挂会摘掉 src 且 React 不设回 → 媒体没源一直转圈；重挂时补回 src（生产无 StrictMode 不触发）。
  useEffect(() => {
    const m = ref.current;
    if (m && !m.getAttribute("src") && book.audioUrl) { m.setAttribute("src", book.audioUrl); m.load(); }
    return () => { if (m) { m.pause(); m.removeAttribute("src"); m.load(); } };
  }, []);

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  // Media Session：锁屏/控制中心显示书名封面并可播放/暂停/±15s（音频伴读是核心场景，
  // 原来息屏后想暂停只能解锁回页面）。±15s 复用 skipBy（含真实播放基准重置）
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({
        title: book.title,
        artist: book.author || "AI 图书馆",
        album: "AI 图书馆 · 全本朗读",
        artwork: book.cover ? [{ src: book.cover }] : [],
      });
      ms.setActionHandler("play", () => ref.current?.play().catch(() => {}));
      ms.setActionHandler("pause", () => ref.current?.pause());
      ms.setActionHandler("seekbackward", () => skipBy(-15));
      ms.setActionHandler("seekforward", () => skipBy(15));
    } catch {}
    return () => {
      try {
        ms.metadata = null;
        for (const a of ["play", "pause", "seekbackward", "seekforward"] as MediaSessionAction[]) ms.setActionHandler(a, null);
      } catch {}
    };
    // eslint-disable-next-line
  }, [book.id]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setAErr(true)); else a.pause();
  }
  function seek(t: number) {
    setCur(t);
    if (ref.current) ref.current.currentTime = t;
  }
  // 拖动过程中只移动滑块（setScrub），松手才真正定位音频 → 不与 timeupdate 抢值，丝滑不卡
  function commitSeek(t: number) {
    seekReset(); // 重置基准，避免把拖动跳变算成真实播放
    seek(t);
    setScrub(null);
  }
  // ±15 秒快进/快退：复用 commitSeek（含 seekReset 基线重置，防把跳变计入真实播放）
  function skipBy(delta: number) {
    const a = ref.current;
    if (!a) return;
    const d = a.duration || dur;
    let t = a.currentTime + delta;
    if (t < 0) t = 0;
    if (d > 0 && t > d) t = d;
    commitSeek(t);
  }
  function onMeta(e: React.SyntheticEvent<HTMLAudioElement>) {
    const d = e.currentTarget.duration || 0;
    setDur(d);
    primePlayed(d); // 续播覆盖累计基线
    if (!resumed.current && d > 0) {
      resumed.current = true;
      const p = getMediaProgress(book.id);
      if (p > 0 && p < 0.99) { e.currentTarget.currentTime = p * d; setCur(p * d); }
    }
  }

  const R = 34;
  const C = 2 * Math.PI * R;
  const shown = scrub ?? cur; // 拖动中显示临时位置，否则跟随真实播放
  const pct = dur ? Math.min(1, shown / dur) : 0;

  return (
    <div className="flex w-full flex-col items-center pt-2">
      <audio
        ref={ref}
        src={book.audioUrl}
        preload="auto"
        onPlay={() => { arm(); setAErr(false); setPlaying(true); }}
        onPause={() => { setPlaying(false); flush(); }}
        onTimeUpdate={(e) => { const c = e.currentTarget.currentTime; const d = e.currentTarget.duration || 0; setCur(c); setWaiting(false); trackPlayed(c, d); report(c, d); }}
        onLoadedMetadata={onMeta}
        onCanPlay={() => setWaiting(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onError={() => { setAErr(true); setWaiting(false); setPlaying(false); }}
      />

      {/* 唱片台座（圆盘封面用书本封面） */}
      <div className="relative h-36 w-36">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-celadon-soft to-snow shadow-lg dark:from-celadon/20 dark:to-dark-card" />
        <div className="absolute inset-4 rounded-full border border-celadon/20" />
        <div className={"absolute inset-7 overflow-hidden rounded-full shadow-inner " + (playing ? "animate-spin-slow" : "")}>
          {book.cover && coverOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={book.cover} alt="" onError={() => setCoverOk(false)} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-celadon-300 to-celadon-700">
              <span className="font-serif text-lg text-snow">{book.title.slice(0, 2)}</span>
            </div>
          )}
        </div>
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-snow ring-2 ring-celadon/30 dark:bg-dark-card" />
      </div>

      <h3 className="mt-3 font-serif text-lg text-ink dark:text-dark-text">{book.title}</h3>
      <p className="text-xs text-ink-700 dark:text-dark-text/75">{book.author} · 全本朗读</p>
      {aErr && (
        <p className="mt-1.5 text-xs text-rouge">
          音频加载失败{" "}
          <button onClick={() => { setAErr(false); const a = ref.current; if (a) { resumed.current = false; a.load(); a.play().catch(() => setAErr(true)); } }} className="underline underline-offset-2">重试</button>
        </p>
      )}

      {/* 进度条（自定义可视轨道 + 透明原生 range；拖动只移滑块、松手才定位，丝滑不卡） */}
      <div className="mt-4 flex w-full max-w-[320px] items-center gap-2.5">
        <span className="w-10 shrink-0 text-right text-[11px] text-ink-700 tabular-nums dark:text-dark-text/75">{formatTime(shown)}</span>
        <div className="relative h-5 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line dark:bg-white/10" />
          <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-celadon" style={{ width: `${pct * 100}%` }} />
          <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-celadon shadow ring-2 ring-snow dark:ring-dark-card" style={{ left: `${pct * 100}%` }} />
          <input
            type="range"
            min={0}
            max={dur || 1}
            step="any"
            value={shown}
            aria-label="播放进度"
            onChange={(e) => setScrub(+e.target.value)}
            onPointerUp={() => { if (scrub !== null) commitSeek(scrub); }}
            onLostPointerCapture={() => { if (scrub !== null) commitSeek(scrub); }}
            onKeyUp={() => { if (scrub !== null) commitSeek(scrub); }}
            onPointerCancel={() => setScrub(null)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <span className="w-10 shrink-0 text-[11px] text-ink-700 tabular-nums dark:text-dark-text/75">{formatTime(dur)}</span>
      </div>

      {/* 倍速不常用：收成单个按钮，点击循环切换（0.75→1→1.25→1.5→2→回 0.75），不平铺占空间 */}
      <button
        onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
        aria-label={`当前倍速 ${speed}x，点击切换`}
        className="mt-5 inline-flex items-center gap-1 rounded-full bg-snow px-3 py-1 text-[11px] text-ink-500 ring-1 ring-line transition active:scale-95 dark:bg-dark-card dark:text-dark-text/60 dark:ring-white/10"
      >
        倍速 <span className="font-medium tabular-nums text-ink-700 dark:text-dark-text/85">{speed}x</span>
      </button>

      {/* 后退 15 秒 · 播放/暂停（环形进度） · 快进 15 秒 */}
      <div className="mt-6 flex items-center justify-center gap-7">
        <button
          onClick={() => skipBy(-15)}
          aria-label="后退 15 秒"
          className="relative flex h-10 w-10 items-center justify-center rounded-full bg-snow text-ink-700 shadow-sm ring-1 ring-line active:scale-90 dark:bg-dark-card dark:text-dark-text/80 dark:ring-white/10"
        >
          <RotateCcw size={22} strokeWidth={1.8} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-px text-[7px] font-semibold leading-none">15</span>
        </button>
        <button onClick={toggle} aria-label={playing ? "暂停" : "播放"} className="relative flex h-20 w-20 items-center justify-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeWidth="3" className="text-line dark:text-white/10" />
            <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-celadon" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
          </svg>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-celadon text-snow shadow-celadon active:scale-95">
            {playing && waiting ? (
              <span aria-hidden className="h-6 w-6 animate-spin rounded-full border-2 border-snow/40 border-t-snow" />
            ) : playing ? (
              <Pause size={24} />
            ) : (
              <Play size={24} className="ml-0.5" />
            )}
          </span>
        </button>
        <button
          onClick={() => skipBy(15)}
          aria-label="快进 15 秒"
          className="relative flex h-10 w-10 items-center justify-center rounded-full bg-snow text-ink-700 shadow-sm ring-1 ring-line active:scale-90 dark:bg-dark-card dark:text-dark-text/80 dark:ring-white/10"
        >
          <RotateCw size={22} strokeWidth={1.8} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center pt-px text-[7px] font-semibold leading-none">15</span>
        </button>
      </div>
    </div>
  );
}
