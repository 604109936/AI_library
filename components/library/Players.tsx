"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Rewind, FastForward, Clock } from "lucide-react";
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

/* ----------------------------- 视频解读（抖音竖屏，不分章节） ----------------------------- */
export function VideoMode({ book }: { book: Book }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const report = useHistoryReporter(book, "video");

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
  }

  return (
    <div className="flex flex-col items-center">
      {/* 竖屏播放器 */}
      <div className="relative mx-auto aspect-[9/16] w-[64%] max-w-[260px] overflow-hidden rounded-2xl bg-black shadow-lg">
        <video
          ref={ref}
          src={book.videoUrl}
          poster={book.posterUrl}
          playsInline
          className="h-full w-full object-cover"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); report(e.currentTarget.currentTime, e.currentTarget.duration || 0); }}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        />
        {!playing && (
          <button onClick={toggle} aria-label="播放" className="absolute inset-0 flex items-center justify-center bg-black/15">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-celadon/90 shadow-celadon backdrop-blur">
              <Play size={26} className="ml-1 fill-snow text-snow" />
            </span>
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6 text-white">
          <button onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <span className="w-8 text-[10px] tabular-nums">{formatTime(cur)}</span>
          <input type="range" min={0} max={dur || 1} value={cur} aria-label="播放进度" onChange={(e) => { if (ref.current) ref.current.currentTime = +e.target.value; }} className="h-1 flex-1 accent-celadon" />
          <span className="w-8 text-[10px] tabular-nums">{formatTime(dur)}</span>
        </div>
      </div>

      <p className="mt-4 flex items-center gap-2 font-serif text-sm text-ink dark:text-dark-text">
        《{book.title}》精读解读
        <span className="flex items-center gap-0.5 text-xs font-sans text-ink-300"><Clock size={12} /> {formatTime(dur)}</span>
      </p>
      <div className="mt-2 flex gap-1">
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={"rounded px-2 py-0.5 text-[11px] " + (speed === s ? "bg-celadon text-snow" : "text-ink-300")}>{s}x</button>
        ))}
      </div>
      <p className="mt-4 max-w-[680px] px-2 text-center text-sm leading-6 text-ink-500 dark:text-dark-text/60">{book.summary}</p>
    </div>
  );
}

/* ----------------------------- 音频伴读（整本朗读，不分章节，±15s） ----------------------------- */
export function AudioMode({ book }: { book: Book }) {
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
    <div className="flex flex-col items-center pt-2">
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

      <div className="mt-4 flex w-full items-center gap-2">
        <span className="w-10 text-right text-[11px] text-ink-300 tabular-nums">{formatTime(cur)}</span>
        <input type="range" min={0} max={dur || 1} value={cur} aria-label="播放进度" onChange={(e) => { if (ref.current) ref.current.currentTime = +e.target.value; }} className="h-1 flex-1 accent-celadon" />
        <span className="w-10 text-[11px] text-ink-300 tabular-nums">{formatTime(dur)}</span>
      </div>

      {/* 控制：后退15s / 环形播放键 / 前进15s */}
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

      <p className="mt-5 max-w-[680px] px-2 text-center text-sm leading-6 text-ink-500 dark:text-dark-text/60">{book.summary}</p>
    </div>
  );
}
