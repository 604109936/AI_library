"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Rewind, FastForward, Maximize2, Minimize2, Volume2, VolumeX, Video, Headphones } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { formatTime } from "@/lib/utils";
import { useLibrary } from "@/lib/store";
import type { Book } from "@/lib/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function useHistoryReporter(book: Book, mode: "video" | "audio") {
  const pushHistory = useLibrary((s) => s.pushHistory);
  const setProgress = useLibrary((s) => s.setProgress);
  const last = useRef(0);
  return (cur: number, dur: number) => {
    const now = Date.now();
    if (dur <= 0 || now - last.current < 5000) return;
    last.current = now;
    const pct = Math.max(1, Math.round((cur / dur) * 100));
    pushHistory({ bookId: book.id, bookTitle: book.title, author: book.author, coverSeed: book.coverSeed, cover: book.cover, mode, progress: pct, lastAt: new Date().toISOString() });
    setProgress({ bookId: book.id, chapterId: `${book.id}-${mode}`, chapterNo: 1, pct, mode });
  };
}

/* ============================ 详情页顶部媒体台 ============================ */
/** 封面即播放入口：竖屏友好的视频播放器（可全屏），并可一键切换为音频伴读。 */
export function BookMediaHero({ book }: { book: Book }) {
  const canVideo = book.hasVideo;
  const canAudio = book.hasAudio;
  const [mode, setMode] = useState<"video" | "audio">(canVideo ? "video" : "audio");

  // 既无视频也无音频：只展示封面
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
        {/* 固定高度：视频卡(3:4)与音频盘共用同一高度，切换不顶动下方内容 */}
        <div className="flex min-h-[400px] items-center justify-center">
          {mode === "video" && canVideo ? <VideoStage book={book} /> : <AudioStage book={book} />}
        </div>

        {/* 视频 / 音频 切换（卡片下方右对齐） */}
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

/* ----------------------------- 竖屏视频（抖音式竖屏全屏） ----------------------------- */
function VideoStage({ book }: { book: Book }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const [fs, setFs] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const report = useHistoryReporter(book, "video");

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);
  // 竖屏全屏 = 铺满「手机列宽 × 视口高」的浮层（不调用原生全屏，避免桌面被拉成横屏）；开启时锁背景滚动
  useEffect(() => {
    if (!fs) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [fs]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { v.play(); setStarted(true); } else v.pause();
  }
  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
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
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); report(e.currentTarget.currentTime, e.currentTarget.duration || 0); }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
      />

      {/* 海报入口（未开始）：封面 + 居中播放钮，对齐设计稿 */}
      {!started && (
        <button onClick={toggle} aria-label="播放视频解读" className="absolute inset-0 flex items-center justify-center bg-black/10">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-celadon/85 shadow-celadon backdrop-blur">
            <Play size={30} className="ml-1 fill-snow text-snow" />
          </span>
        </button>
      )}

      {/* 暂停态（已开始） */}
      {started && !playing && (
        <button onClick={toggle} aria-label="播放" className="absolute inset-0 flex items-center justify-center bg-black/15">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-celadon/90 shadow-celadon backdrop-blur">
            <Play size={26} className="ml-1 fill-snow text-snow" />
          </span>
        </button>
      )}

      {/* 右上：静音 + 全屏/退出（开播后才显示，海报态保持干净） */}
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

      {/* 底部控制条（已开始） */}
      {started && (
        <div className={"absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 text-white " + (fs ? "pb-[calc(env(safe-area-inset-bottom)+18px)] pt-12" : "pb-2 pt-6")}>
          <button onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={fs ? 20 : 16} /> : <Play size={fs ? 20 : 16} />}
          </button>
          <span className={"shrink-0 tabular-nums " + (fs ? "w-10 text-xs" : "w-8 text-[10px]")}>{formatTime(cur)}</span>
          <input type="range" min={0} max={dur || 1} value={cur} aria-label="播放进度" onChange={(e) => { if (ref.current) ref.current.currentTime = +e.target.value; }} className="h-1 flex-1 accent-celadon" />
          <span className={"shrink-0 tabular-nums " + (fs ? "w-10 text-xs" : "w-8 text-[10px]")}>{formatTime(dur)}</span>
          <button onClick={cycleSpeed} aria-label="倍速" className={"shrink-0 font-medium tabular-nums " + (fs ? "w-9 text-xs" : "w-7 text-[10px]")}>{speed}x</button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- 音频伴读（整本朗读，±15s） ----------------------------- */
function AudioStage({ book }: { book: Book }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [coverOk, setCoverOk] = useState(true);
  const report = useHistoryReporter(book, "audio");

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (playing) a.pause(); else a.play();
  }
  function skip(sec: number) {
    const a = ref.current;
    if (!a || !dur) return;
    a.currentTime = Math.min(dur, Math.max(0, a.currentTime + sec));
  }

  const R = 34;
  const C = 2 * Math.PI * R;
  const pct = dur ? cur / dur : 0;

  return (
    <div className="flex w-full flex-col items-center pt-2">
      <audio
        ref={ref}
        src={book.audioUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); report(e.currentTarget.currentTime, e.currentTarget.duration || 0); }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
      />

      {/* 唱片台座 */}
      <div className="relative h-48 w-48">
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

      <h3 className="mt-4 font-serif text-lg text-ink dark:text-dark-text">{book.title}</h3>
      <p className="text-xs text-ink-500 dark:text-dark-text/55">{book.author} · 全本朗读</p>

      <div className="mt-4 flex w-full max-w-[320px] items-center gap-2">
        <span className="w-10 text-right text-[11px] text-ink-300 tabular-nums">{formatTime(cur)}</span>
        <input type="range" min={0} max={dur || 1} value={cur} aria-label="播放进度" onChange={(e) => { if (ref.current) ref.current.currentTime = +e.target.value; }} className="h-1 flex-1 accent-celadon" />
        <span className="w-10 text-[11px] text-ink-300 tabular-nums">{formatTime(dur)}</span>
      </div>

      {/* 后退15s / 环形播放键 / 前进15s */}
      <div className="mt-4 flex items-center gap-8">
        <button onClick={() => skip(-15)} aria-label="后退15秒" className="flex flex-col items-center text-ink-500 dark:text-dark-text/70">
          <Rewind size={24} />
          <span className="text-[9px]">15s</span>
        </button>
        <button onClick={toggle} aria-label={playing ? "暂停" : "播放"} className="relative flex h-20 w-20 items-center justify-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeWidth="3" className="text-line dark:text-white/10" />
            <circle cx="40" cy="40" r={R} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-celadon" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
          </svg>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-celadon text-snow shadow-celadon active:scale-95">
            {playing ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
          </span>
        </button>
        <button onClick={() => skip(15)} aria-label="前进15秒" className="flex flex-col items-center text-ink-500 dark:text-dark-text/70">
          <FastForward size={24} />
          <span className="text-[9px]">15s</span>
        </button>
      </div>

      <div className="mt-3 flex gap-1">
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={"rounded px-1.5 py-0.5 text-[11px] " + (speed === s ? "bg-celadon text-snow" : "text-ink-300")}>{s}x</button>
        ))}
      </div>
    </div>
  );
}
