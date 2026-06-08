"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Maximize2, Minimize2, Volume2, VolumeX, Video, Headphones } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { formatTime } from "@/lib/utils";
import { useLibrary } from "@/lib/store";
import { useReadingClock } from "@/lib/useReadingClock";
import type { Book } from "@/lib/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function useHistoryReporter(book: Book, mode: "video" | "audio") {
  const pushHistory = useLibrary((s) => s.pushHistory);
  const setMediaProgress = useLibrary((s) => s.setMediaProgress);
  const setMediaPlayed = useLibrary((s) => s.setMediaPlayed);
  const realId = book.id.split("__")[0];
  const last = useRef(0);
  const latest = useRef({ cur: 0, dur: 0 });
  const lastT = useRef<number | null>(null);
  const playedSec = useRef(0);
  const write = (cur: number, dur: number) => {
    if (dur <= 0) return;
    // 进度=真实播放覆盖（≥90% 记 100）。音视频不写 progress（progress 专给文字稿续读/章节态，避免跨模式互相覆盖）
    const played = useLibrary.getState().mediaPlayed[realId] ?? 0;
    const prog = played >= 0.9 ? 100 : Math.round(played * 100);
    pushHistory({ bookId: realId, bookTitle: book.title, author: book.author, coverSeed: book.coverSeed, cover: book.cover, mode, progress: prog, lastAt: new Date().toISOString() });
    setMediaProgress(realId, cur / dur);
  };
  const report = (cur: number, dur: number) => {
    latest.current = { cur, dur };
    const now = Date.now();
    if (now - last.current < 5000) return;
    last.current = now;
    write(cur, dur);
  };
  const flush = () => write(latest.current.cur, latest.current.dur);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
  // 续播：把已存覆盖作为基线，使新会话能在旧覆盖上继续累计（否则只增设计会"卡住"到不了 100%）
  const primePlayed = (dur: number) => {
    if (dur > 0) playedSec.current = (useLibrary.getState().mediaPlayed[realId] ?? 0) * dur;
  };
  // 真实播放累计：仅连续正常推进（增量 0~1.5s）计入，拖动/快进的大跳变不计 → 排除「拖到结尾」
  const trackPlayed = (cur: number, dur: number) => {
    if (dur > 0 && lastT.current !== null) {
      const d = cur - lastT.current;
      if (d > 0 && d < 1.5) { playedSec.current += d; setMediaPlayed(realId, playedSec.current / dur); }
    }
    lastT.current = cur;
  };
  const seekReset = () => { lastT.current = null; }; // 拖动/快进后重置基准，避免把跳变误计为真实播放
  return { report, flush, trackPlayed, primePlayed, seekReset };
}

/* ============================ 详情页顶部媒体台 ============================ */
export function BookMediaHero({ book }: { book: Book }) {
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
          {mode === "video" && canVideo ? <VideoStage book={book} /> : <AudioStage book={book} />}
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
                    (mode === k ? "bg-celadon text-snow shadow-celadon" : "text-ink-500 dark:text-dark-text/60")
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
function VideoStage({ book }: { book: Book }) {
  const ref = useRef<HTMLVideoElement>(null);
  const getMediaProgress = useLibrary((s) => s.getMediaProgress);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const [fs, setFs] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const resumed = useRef(false);
  const { report, flush, trackPlayed, primePlayed, seekReset } = useHistoryReporter(book, "video");
  useReadingClock(playing); // 观看时长计入「我的-总时长」

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);
  useEffect(() => {
    if (!fs) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [fs]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { setStarted(true); v.play().catch(() => setStarted(false)); } else v.pause();
  }
  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }
  function seek(t: number) {
    seekReset(); // 拖动后重置基准，避免把跳变算成真实播放
    setCur(t); // 即时更新进度，拖动跟手
    if (ref.current) ref.current.currentTime = t;
  }
  function onMeta(e: React.SyntheticEvent<HTMLVideoElement>) {
    const d = e.currentTarget.duration || 0;
    setDur(d);
    primePlayed(d); // 续播覆盖累计基线
    if (!resumed.current && d > 0) {
      resumed.current = true;
      const p = getMediaProgress(book.id);
      if (p > 0 && p < 0.99) { e.currentTarget.currentTime = p * d; setCur(p * d); }
    }
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
        muted={muted}
        className={fs ? "h-full w-full object-contain" : "h-full w-full object-cover"}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); flush(); }}
        onTimeUpdate={(e) => { const c = e.currentTarget.currentTime; const d = e.currentTarget.duration || 0; setCur(c); report(c, d); trackPlayed(c, d); }}
        onLoadedMetadata={onMeta}
      />

      {!started && (
        <button onClick={toggle} aria-label="播放视频解读" className="absolute inset-0 flex items-center justify-center bg-black/10">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-celadon/85 shadow-celadon backdrop-blur">
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
          <button onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={fs ? 20 : 16} /> : <Play size={fs ? 20 : 16} />}
          </button>
          <span className={"shrink-0 tabular-nums " + (fs ? "w-10 text-xs" : "w-8 text-[10px]")}>{formatTime(cur)}</span>
          <input type="range" min={0} max={dur || 1} step="any" value={cur} aria-label="播放进度" onChange={(e) => seek(+e.target.value)} className="h-1 flex-1 accent-celadon" />
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
  const resumed = useRef(false);
  const { report, flush, trackPlayed, primePlayed, seekReset } = useHistoryReporter(book, "audio");
  useReadingClock(playing); // 收听时长计入「我的-总时长」

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
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
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); flush(); }}
        onTimeUpdate={(e) => { const c = e.currentTarget.currentTime; const d = e.currentTarget.duration || 0; setCur(c); report(c, d); trackPlayed(c, d); }}
        onLoadedMetadata={onMeta}
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
      <p className="text-xs text-ink-500 dark:text-dark-text/55">{book.author} · 全本朗读</p>

      {/* 进度条（自定义可视轨道 + 透明原生 range；拖动只移滑块、松手才定位，丝滑不卡） */}
      <div className="mt-4 flex w-full max-w-[320px] items-center gap-2.5">
        <span className="w-10 shrink-0 text-right text-[11px] text-ink-500 tabular-nums dark:text-dark-text/55">{formatTime(shown)}</span>
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
        <span className="w-10 shrink-0 text-[11px] text-ink-500 tabular-nums dark:text-dark-text/55">{formatTime(dur)}</span>
      </div>

      {/* 倍速（更大点击区、配色清晰） */}
      <div className="mt-5 flex items-center gap-2">
        <span className="mr-0.5 text-[11px] text-ink-500 dark:text-dark-text/55">倍速</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={
              "min-w-[44px] rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 " +
              (speed === s
                ? "bg-celadon text-snow shadow-celadon"
                : "bg-snow text-ink-700 ring-1 ring-line dark:bg-dark-card dark:text-dark-text/80 dark:ring-white/10")
            }
          >
            {s}x
          </button>
        ))}
      </div>

      {/* 播放 / 暂停（环形进度） */}
      <div className="mt-6 flex items-center justify-center">
        <button onClick={toggle} aria-label={playing ? "暂停" : "播放"} className="relative flex h-20 w-20 items-center justify-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeWidth="3" className="text-line dark:text-white/10" />
            <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-celadon" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
          </svg>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-celadon text-snow shadow-celadon active:scale-95">
            {playing ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
          </span>
        </button>
      </div>
    </div>
  );
}
