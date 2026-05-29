"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, ChevronDown, Clock, AudioLines } from "lucide-react";
import { formatTime } from "@/lib/utils";
import { useLibrary } from "@/lib/store";
import type { Book, Chapter } from "@/lib/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

function useHistoryReporter(book: Book, mode: "video" | "audio") {
  const pushHistory = useLibrary((s) => s.pushHistory);
  const setProgress = useLibrary((s) => s.setProgress);
  const last = useRef(0);
  return (cur: number, dur: number, chapterNo: number) => {
    const now = Date.now();
    if (dur <= 0 || now - last.current < 5000) return;
    last.current = now;
    const pct = Math.max(1, Math.round((cur / dur) * 100));
    pushHistory({ bookId: book.id, bookTitle: book.title, author: book.author, coverSeed: book.coverSeed, cover: book.cover, mode, progress: pct, lastAt: new Date().toISOString() });
    setProgress({ bookId: book.id, chapterId: `${book.id}-c${chapterNo}`, chapterNo, pct, mode });
  };
}

/* ----------------------------- 视频解读 ----------------------------- */
export function VideoMode({ book, chapters }: { book: Book; chapters: Chapter[] }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [activeCh, setActiveCh] = useState(0);
  const report = useHistoryReporter(book, "video");

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }
  function seekChapter(i: number) {
    const v = ref.current;
    if (!v || !dur) return;
    setActiveCh(i);
    v.currentTime = (i / chapters.length) * dur;
    v.play();
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-black shadow-sm">
        <video
          ref={ref}
          src={book.videoUrl}
          poster={book.posterUrl}
          playsInline
          className="aspect-video w-full"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            setCur(e.currentTarget.currentTime);
            report(e.currentTarget.currentTime, e.currentTarget.duration || 0, activeCh + 1);
          }}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        />
        {/* 大圆播放键覆盖层（未播放时） */}
        {!playing && (
          <button onClick={toggle} aria-label="播放" className="absolute inset-0 flex items-center justify-center bg-black/15">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-celadon/90 shadow-celadon backdrop-blur">
              <Play size={28} className="ml-1 fill-snow text-snow" />
            </span>
          </button>
        )}
        {/* 自定义控制条 */}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 text-white">
          <button onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <span className="w-9 text-[11px] tabular-nums">{formatTime(cur)}</span>
          <input
            type="range"
            min={0}
            max={dur || 1}
            value={cur}
            aria-label="播放进度"
            onChange={(e) => { if (ref.current) ref.current.currentTime = +e.target.value; }}
            className="h-1 flex-1 accent-celadon"
          />
          <span className="w-9 text-[11px] tabular-nums">{formatTime(dur)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-serif text-sm text-ink dark:text-dark-text">
          《{book.title}》精读解读
        </p>
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={"rounded px-1.5 py-0.5 text-[11px] " + (speed === s ? "bg-celadon text-snow" : "text-ink-300")}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {chapters.map((c, i) => (
          <button
            key={c.id}
            onClick={() => seekChapter(i)}
            className={"flex w-full items-center gap-3 rounded-xl p-3 text-left shadow-sm transition active:scale-[0.99] " + (i === activeCh ? "bg-celadon-soft dark:bg-celadon/15" : "bg-snow dark:bg-dark-card")}
          >
            <span className={"flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs " + (i === activeCh ? "bg-celadon text-snow" : "bg-celadon-soft text-celadon-700 dark:bg-white/10 dark:text-celadon-300")}>{c.no}</span>
            <span className="flex-1 truncate text-sm text-ink-700 dark:text-dark-text/85">第{c.no}章 {c.title}</span>
            {i === activeCh && playing && <AudioLines size={15} className="text-celadon" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- 音频伴读 ----------------------------- */
export function AudioMode({ book, chapters }: { book: Book; chapters: Chapter[] }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [idx, setIdx] = useState(0);
  const [listOpen, setListOpen] = useState(true);
  const [coverOk, setCoverOk] = useState(true);
  const report = useHistoryReporter(book, "audio");

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (playing) a.pause();
    else a.play();
  }
  function goChapter(i: number) {
    const a = ref.current;
    const n = Math.min(chapters.length - 1, Math.max(0, i));
    setIdx(n);
    if (a && dur) {
      a.currentTime = (n / chapters.length) * dur; // mock：按章节比例 seek
      a.play();
    }
  }

  // 环形进度
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
        onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); report(e.currentTarget.currentTime, e.currentTarget.duration || 0, idx + 1); }}
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
      <p className="text-xs text-ink-500 dark:text-dark-text/55">第{chapters[idx]?.no} 章 · {chapters[idx]?.title}</p>

      <div className="mt-4 flex w-full items-center gap-2">
        <span className="w-10 text-right text-[11px] text-ink-300 tabular-nums">{formatTime(cur)}</span>
        <input
          type="range"
          min={0}
          max={dur || 1}
          value={cur}
          aria-label="播放进度"
          onChange={(e) => { if (ref.current) ref.current.currentTime = +e.target.value; }}
          className="h-1 flex-1 accent-celadon"
        />
        <span className="w-10 text-[11px] text-ink-300 tabular-nums">{formatTime(dur)}</span>
      </div>

      {/* 控制：上一章 / 环形播放键 / 下一章 */}
      <div className="mt-4 flex items-center gap-8">
        <button onClick={() => goChapter(idx - 1)} aria-label="上一章" disabled={idx === 0} className="text-ink-500 disabled:opacity-30 dark:text-dark-text/70">
          <SkipBack size={26} />
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
        <button onClick={() => goChapter(idx + 1)} aria-label="下一章" disabled={idx === chapters.length - 1} className="text-ink-500 disabled:opacity-30 dark:text-dark-text/70">
          <SkipForward size={26} />
        </button>
      </div>

      <div className="mt-3 flex gap-1">
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={"rounded px-1.5 py-0.5 text-[11px] " + (speed === s ? "bg-celadon text-snow" : "text-ink-300")}>{s}x</button>
        ))}
      </div>

      {/* 章节列表（可折叠） */}
      <div className="mt-5 w-full">
        <button onClick={() => setListOpen((v) => !v)} className="flex w-full items-center justify-between py-1 text-xs text-ink-500 dark:text-dark-text/60">
          <span className="flex items-center gap-1"><Clock size={12} /> 章节列表</span>
          <ChevronDown size={15} className={"transition-transform " + (listOpen ? "rotate-180" : "")} />
        </button>
        {listOpen && (
          <div className="divide-y divide-line dark:divide-white/10">
            {chapters.map((c, i) => (
              <button
                key={c.id}
                onClick={() => goChapter(i)}
                className={"flex w-full items-center justify-between py-2.5 text-left text-sm " + (i === idx ? "text-celadon" : "text-ink-700 dark:text-dark-text/80")}
              >
                <span>第{c.no}章 {c.title}</span>
                {i === idx && playing && <AudioLines size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
