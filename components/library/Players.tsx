"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { formatTime } from "@/lib/utils";
import type { Book, Chapter } from "@/lib/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function VideoMode({ book, chapters }: { book: Book; chapters: Chapter[] }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);
  return (
    <div>
      <div className="overflow-hidden rounded-xl bg-black">
        <video
          ref={ref}
          src={book.videoUrl}
          controls
          playsInline
          className="aspect-video w-full"
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="font-serif text-sm text-ink dark:text-dark-text">《{book.title}》精读解读</p>
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
      <ChapterCards book={book} chapters={chapters} />
    </div>
  );
}

export function AudioMode({ book, chapters }: { book: Book; chapters: Chapter[] }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (playing) a.pause();
    else a.play();
  }

  return (
    <div className="flex flex-col items-center pt-2">
      <audio
        ref={ref}
        src={book.audioUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
      />
      <div className={"transition " + (playing ? "animate-[spin_8s_linear_infinite]" : "")}>
        <BookCover title={book.title} seed={book.coverSeed} className="w-40" rounded="rounded-full" showText={false} />
      </div>
      <h3 className="mt-4 font-serif text-lg text-ink dark:text-dark-text">{book.title}</h3>
      <p className="text-xs text-ink-500">{book.author}</p>

      <div className="mt-4 w-full">
        <div className="flex items-center gap-2">
          <span className="w-10 text-right text-[11px] text-ink-300">{formatTime(cur)}</span>
          <input
            type="range"
            min={0}
            max={dur || 1}
            value={cur}
            onChange={(e) => { if (ref.current) ref.current.currentTime = +e.target.value; }}
            className="h-1 flex-1 accent-celadon"
          />
          <span className="w-10 text-[11px] text-ink-300">{formatTime(dur)}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-8">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} className="text-ink-500">
          <SkipBack size={26} />
        </button>
        <button
          onClick={toggle}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-celadon text-snow shadow-celadon active:scale-95"
        >
          {playing ? <Pause size={26} /> : <Play size={26} className="ml-0.5" />}
        </button>
        <button onClick={() => setIdx((i) => Math.min(chapters.length - 1, i + 1))} className="text-ink-500">
          <SkipForward size={26} />
        </button>
      </div>
      <div className="mt-3 flex gap-1">
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

      <div className="mt-5 w-full">
        <p className="mb-1 text-xs text-ink-300">章节列表</p>
        <div className="divide-y divide-line">
          {chapters.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setIdx(i)}
              className={"flex w-full items-center justify-between py-2.5 text-left text-sm " + (i === idx ? "text-celadon" : "text-ink-700")}
            >
              <span>第{c.no}章 {c.title}</span>
              {i === idx && playing && <span className="text-[10px]">播放中</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChapterCards({ book, chapters }: { book: Book; chapters: Chapter[] }) {
  return (
    <div className="mt-3 space-y-2">
      {chapters.slice(0, 3).map((c) => (
        <a
          key={c.id}
          href={`/library/book/${book.id}/read?ch=${c.id}`}
          className="flex items-center gap-3 rounded-lg bg-snow p-3 shadow-sm dark:bg-dark-card"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-celadon-soft text-xs text-celadon-700">{c.no}</span>
          <span className="text-sm text-ink-700 dark:text-dark-text">第{c.no}章 {c.title}</span>
        </a>
      ))}
    </div>
  );
}
