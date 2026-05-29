"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Rewind, FastForward, Maximize2, Volume2, VolumeX, Video, Headphones } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { formatTime } from "@/lib/utils";
import { useLibrary } from "@/lib/store";
import type { Book } from "@/lib/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/** iOS/桌面端的全屏接口差异兼容 */
type FsVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitRequestFullscreen?: () => void;
};

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
    <div className="flex flex-col items-center px-4 pt-16 pb-3">
      {mode === "video" && canVideo ? <VideoStage book={book} /> : <AudioStage book={book} />}

      {/* 视频 / 音频 切换 */}
      {canVideo && canAudio && (
        <div className="mt-4 inline-flex rounded-full border border-line bg-snow/85 p-1 shadow-sm backdrop-blur dark:border-white/10 dark:bg-dark-card/85">
          {([["video", "视频解读", Video], ["audio", "音频伴读", Headphones]] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition " +
                (mode === k ? "bg-celadon text-snow shadow-celadon" : "text-ink-500 dark:text-dark-text/60")
              }
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- 竖屏视频（可全屏） ----------------------------- */
function VideoStage({ book }: { book: Book }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const report = useHistoryReporter(book, "video");

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { v.play(); setStarted(true); } else v.pause();
  }
  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }
  function fullscreen() {
    const v = ref.current as FsVideo | null;
    if (!v) return;
    if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
    else if (v.requestFullscreen) v.requestFullscreen();
    else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
  }

  return (
    <div className="relative aspect-[9/16] w-[62%] max-w-[252px] overflow-hidden rounded-3xl bg-black shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
      <video
        ref={ref}
        src={book.videoUrl}
        poster={book.posterUrl}
        playsInline
        muted={muted}
        className="h-full w-full object-cover"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); report(e.currentTarget.currentTime, e.currentTarget.duration || 0); }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
      />

      {/* 海报入口（未开始） */}
      {!started && (
        <button onClick={toggle} aria-label="播放视频解读" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-t from-black/45 via-black/10 to-black/15">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-celadon/90 shadow-celadon backdrop-blur">
            <Play size={30} className="ml-1 fill-snow text-snow" />
          </span>
          <span className="text-xs text-white/90 drop-shadow">点击播放 · 视频解读</span>
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

      {/* 右上：静音 + 全屏 */}
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "取消静音" : "静音"} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur active:scale-90">
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <button onClick={fullscreen} aria-label="全屏播放" className="flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur active:scale-90">
          <Maximize2 size={15} />
        </button>
      </div>

      {/* 底部控制条（已开始） */}
      {started && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6 text-white">
          <button onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <span className="w-8 text-[10px] tabular-nums">{formatTime(cur)}</span>
          <input type="range" min={0} max={dur || 1} value={cur} aria-label="播放进度" onChange={(e) => { if (ref.current) ref.current.currentTime = +e.target.value; }} className="h-1 flex-1 accent-celadon" />
          <span className="w-8 text-[10px] tabular-nums">{formatTime(dur)}</span>
          <button onClick={cycleSpeed} aria-label="倍速" className="w-7 shrink-0 text-[10px] font-medium tabular-nums">{speed}x</button>
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
