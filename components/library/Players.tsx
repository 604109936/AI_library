"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Rewind, FastForward, Maximize2, Minimize2, Volume2, VolumeX, Video, Headphones } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { MediaSpinner, MediaError } from "@/components/ui/States";
import { formatTime } from "@/lib/utils";
import { useLibrary, useReader } from "@/lib/store";
import type { Book } from "@/lib/types";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/** 历史/进度上报：5 秒节流；force 绕过节流（用于 onEnded 与离开页面 flush）。 */
function useHistoryReporter(book: Book, mode: "video" | "audio") {
  const pushHistory = useLibrary((s) => s.pushHistory);
  const setProgress = useLibrary((s) => s.setProgress);
  const last = useRef(0);
  // 记住最近一次 cur/dur，卸载时据此 flush 最终进度
  const latest = useRef({ cur: 0, dur: 0 });
  const report = useCallback(
    (cur: number, dur: number, force = false) => {
      latest.current = { cur, dur };
      if (dur <= 0) return;
      const now = Date.now();
      if (!force && now - last.current < 5000) return; // ended/flush 时 force 绕过 5s 节流
      last.current = now;
      const pct = Math.min(100, Math.max(1, Math.round((cur / dur) * 100))); // 加 min(100,…) 防越界
      pushHistory({ bookId: book.id, bookTitle: book.title, author: book.author, coverSeed: book.coverSeed, cover: book.cover, mode, progress: pct, lastAt: new Date().toISOString() });
      setProgress({ bookId: book.id, chapterId: `${book.id}-${mode}`, chapterNo: 1, pct, mode });
    },
    [book, mode, pushHistory, setProgress]
  );
  // 离开详情页（卸载）时用最近 cur/dur 强制 flush 一次最终进度
  useEffect(
    () => () => {
      const { cur, dur } = latest.current;
      if (dur > 0) report(cur, dur, true);
    },
    [report]
  );
  return report;
}

/* ----------------------------- 共享进度条（视频/音频复用） ----------------------------- */
/** 自绘进度条：粗轨 + 青瓷已读填充 + 大滑块，并用负边距把不可见 range 撑到 h-8 大热区便于拇指拖动。
 *  big：全屏态加大轨道与滑块；onDark：深色背景（视频底部渐变）下加亮底轨。 */
function Scrubber({ value, max, onSeek, big, onDark }: { value: number; max: number; onSeek: (t: number) => void; big?: boolean; onDark?: boolean }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className={"relative flex-1 " + (big ? "h-2.5" : "h-2")}>
      <div className={"absolute inset-0 rounded-full " + (onDark ? "bg-white/25" : "bg-ink/15 dark:bg-white/15")} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-celadon" style={{ width: `${pct * 100}%` }} />
      <div
        className={"absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-celadon shadow ring-2 ring-snow dark:ring-dark-card " + (big ? "h-4 w-4" : "h-3.5 w-3.5")}
        style={{ left: `${pct * 100}%` }}
      />
      {/* -my-3 h-8 把不可见 range 撑出大热区 */}
      <input
        type="range"
        min={0}
        max={max || 1}
        value={value}
        aria-label="播放进度"
        onChange={(e) => onSeek(+e.target.value)}
        className="absolute inset-x-0 top-1/2 -my-3 h-8 w-full -translate-y-1/2 cursor-pointer opacity-0"
      />
    </div>
  );
}

/* ----------------------------- 共享倍速药丸（视频/音频统一为「直选」心智） ----------------------------- */
function SpeedPills({ speed, onChange }: { speed: number; onChange: (s: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-0.5 text-micro text-ink-500 dark:text-dark-text/55">倍速</span>
      {SPEEDS.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          aria-pressed={speed === s}
          className={
            "rounded-full px-2 py-0.5 text-caption font-medium transition " +
            (speed === s ? "bg-celadon text-snow" : "bg-snow text-ink-500 ring-1 ring-line dark:bg-dark-card dark:text-dark-text/70 dark:ring-white/10")
          }
        >
          {s}x
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- 视频中央播放钮（海报态/暂停态共用） ----------------------------- */
function PlayOverlay({ big, onClick }: { big: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={big ? "播放视频解读" : "播放"}
      className={"absolute inset-0 flex items-center justify-center " + (big ? "bg-black/10" : "bg-black/15")}
    >
      <span className={"flex items-center justify-center rounded-full bg-celadon/85 shadow-celadon backdrop-blur " + (big ? "h-16 w-16" : "h-14 w-14")}>
        <Play size={big ? 30 : 26} className="ml-1 fill-snow text-snow" />
      </span>
    </button>
  );
}

/* ============================ 详情页顶部媒体台 ============================ */
/** 封面即播放入口：竖屏友好的视频播放器（可全屏），并可一键切换为音频伴读。 */
export function BookMediaHero({ book }: { book: Book }) {
  const canVideo = book.hasVideo;
  const canAudio = book.hasAudio;
  const defaultMode = useReader((s) => s.defaultMode);
  const readerHydrated = useReader((s) => s.hydrated);
  // 初始保持确定性，避免水合不一致
  const [mode, setMode] = useState<"video" | "audio">(canVideo ? "video" : "audio");

  // 水合完成后按用户设置偏好选择（text 或所选媒体缺失则回退到可用介质）
  useEffect(() => {
    if (!readerHydrated) return;
    if (defaultMode === "audio" && canAudio) setMode("audio");
    else if (defaultMode === "video" && canVideo) setMode("video");
    else setMode(canVideo ? "video" : "audio");
  }, [readerHydrated, defaultMode, canVideo, canAudio]);

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

  // 当前活跃介质（用于切走时暂停隐藏介质）
  const videoActive = mode === "video" && canVideo;
  const audioActive = !videoActive && canAudio;

  return (
    <div className="flex flex-col items-center px-4 pt-16 pb-2">
      <div className="w-full max-w-[300px]">
        {/* 固定高度：视频卡(3:4)与音频盘共用同一高度，切换不顶动下方内容。
            两个 Stage 常驻挂载、用 hidden 显隐（state 不丢，切回继续），靠 active 自暂停隐藏介质。 */}
        <div className="flex min-h-[400px] items-center justify-center">
          {canVideo && (
            <div className={videoActive ? "w-full" : "hidden"}>
              <VideoStage book={book} active={videoActive} />
            </div>
          )}
          {canAudio && (
            <div className={audioActive ? "w-full" : "hidden"}>
              <AudioStage book={book} active={audioActive} />
            </div>
          )}
        </div>

        {/* 视频 / 音频 切换（卡片下方右对齐） */}
        {canVideo && canAudio && (
          <div className="mt-3 flex justify-end">
            <div className="inline-flex rounded-full border border-line bg-snow/85 p-1 shadow-sm backdrop-blur dark:border-white/10 dark:bg-dark-card/85">
              {([["video", "视频", Video], ["audio", "音频", Headphones]] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  onClick={() => setMode(k)}
                  aria-pressed={mode === k}
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
function VideoStage({ book, active }: { book: Book; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const exitBtnRef = useRef<HTMLButtonElement>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [started, setStarted] = useState(false);
  const [fs, setFs] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [err, setErr] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false); // 紧凑态倍速浮层
  const report = useHistoryReporter(book, "video");

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  // 切走（非活跃）时暂停隐藏介质，避免两路媒体同时出声
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);

  // 竖屏全屏 = 铺满「手机列宽 × 视口高」的浮层（不调用原生全屏，避免桌面被拉成横屏）。
  // 开启时：锁背景滚动 + Esc 退出 + 拦截移动端返回键先收全屏 + 焦点移入退出按钮。
  useEffect(() => {
    if (!fs) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFs(false); };
    const onPop = () => setFs(false);
    window.addEventListener("keydown", onKey);
    // 压入占位历史项，使移动端物理返回键先收全屏而非离开页面
    let pushed = false;
    if (typeof window !== "undefined") {
      window.history.pushState({ fs: true }, "");
      pushed = true;
      window.addEventListener("popstate", onPop);
    }
    // 焦点移入退出按钮（弱焦点陷阱）
    exitBtnRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      // 若退出由按钮触发（非返回键），把我们 push 的占位项弹掉，避免用户多按一次返回
      if (pushed && typeof window !== "undefined" && window.history.state?.fs) window.history.back();
    };
  }, [fs]);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    setErr(false); // 恢复播放时复位失败态
    if (v.paused) { v.play(); setStarted(true); } else v.pause();
  }
  function retry() {
    setErr(false);
    setBuffering(true);
    ref.current?.load();
  }

  return (
    <div
      role={fs ? "dialog" : undefined}
      aria-modal={fs ? true : undefined}
      aria-label={fs ? "全屏视频" : undefined}
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
        preload="none"
        playsInline
        muted={muted}
        className={fs ? "h-full w-full object-contain" : "h-full w-full object-cover"}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); report(e.currentTarget.currentTime, e.currentTarget.duration || 0); }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onEnded={(e) => report(e.currentTarget.duration || dur, e.currentTarget.duration || dur, true)}
        onError={() => { setErr(true); setBuffering(false); }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
      />

      {/* 加载失败兜底（深色媒体面，含重试） */}
      {err && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55">
          <MediaError onRetry={retry} text="视频暂时无法播放" />
        </div>
      )}

      {/* 缓冲转圈 */}
      {buffering && !err && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <MediaSpinner className="h-10 w-10" />
        </div>
      )}

      {/* 海报入口（未开始）：封面 + 书名 + 「视频解读·约X分钟」+ 居中播放钮 */}
      {!started && !err && (
        <>
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4 text-snow">
            <h3 className="line-clamp-1 font-serif text-base leading-snug drop-shadow">{book.title}</h3>
            <p className="mt-0.5 text-caption text-snow/85 drop-shadow">视频解读{dur > 0 ? ` · 约 ${Math.round(dur / 60)} 分钟` : ""}</p>
          </div>
          <PlayOverlay big onClick={toggle} />
        </>
      )}

      {/* 暂停态（已开始） */}
      {started && !playing && !err && <PlayOverlay big={false} onClick={toggle} />}

      {/* 右上：静音 + 全屏/退出（开播后才显示，海报态保持干净） */}
      {started && (
        <div className={"absolute z-10 flex gap-1.5 " + (fs ? "right-3 top-[calc(env(safe-area-inset-top)+12px)]" : "right-2 top-2")}>
          <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "取消静音" : "静音"} className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur active:scale-90">
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          {fs ? (
            <button ref={exitBtnRef} onClick={() => setFs(false)} aria-label="退出全屏" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur active:scale-90">
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
          <span className={"shrink-0 tabular-nums " + (fs ? "w-10 text-xs" : "w-8 text-micro")}>{formatTime(cur)}</span>
          <Scrubber value={cur} max={dur} onSeek={(t) => { if (ref.current) ref.current.currentTime = t; }} big={fs} onDark />
          <span className={"shrink-0 tabular-nums " + (fs ? "w-10 text-xs" : "w-8 text-micro")}>{formatTime(dur)}</span>
          {fs ? (
            // 全屏态横向空间充足：直接平铺药丸
            <SpeedPills speed={speed} onChange={setSpeed} />
          ) : (
            // 紧凑态：点 {speed}x 弹出药丸浮层（与音频一致的「直选」心智）
            <div className="relative shrink-0">
              <button
                onClick={() => setShowSpeed((v) => !v)}
                aria-label={`倍速，当前 ${speed} 倍`}
                aria-expanded={showSpeed}
                className="w-7 text-micro font-medium tabular-nums"
              >
                {speed}x
              </button>
              {showSpeed && (
                <div className="absolute bottom-full right-0 mb-1 flex flex-col gap-0.5 rounded-xl bg-black/80 p-1 backdrop-blur">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setSpeed(s); setShowSpeed(false); }}
                      aria-pressed={speed === s}
                      className={"rounded-lg px-2.5 py-1 text-micro font-medium tabular-nums " + (speed === s ? "bg-celadon text-snow" : "text-white/85")}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- 音频伴读（整本朗读，±15s） ----------------------------- */
function AudioStage({ book, active }: { book: Book; active: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [coverOk, setCoverOk] = useState(true);
  const [err, setErr] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const report = useHistoryReporter(book, "audio");

  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  // 切走（非活跃）时暂停隐藏介质
  useEffect(() => {
    if (!active) ref.current?.pause();
  }, [active]);

  function toggle() {
    const a = ref.current;
    if (!a) return;
    setErr(false); // 恢复播放时复位失败态
    if (playing) a.pause(); else a.play();
  }
  function retry() {
    setErr(false);
    setBuffering(true);
    ref.current?.load();
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
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); report(e.currentTarget.currentTime, e.currentTarget.duration || 0); }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onEnded={(e) => report(e.currentTarget.duration || dur, e.currentTarget.duration || dur, true)}
        onError={() => { setErr(true); setBuffering(false); }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
      />

      {/* 唱片台座 */}
      <div className="relative h-40 w-40">
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

        {/* 失败/缓冲态叠加在唱片中央，避免「盘永远停 00:00 不转」的假死（浅色面用深字提示） */}
        {err ? (
          <div className="absolute inset-4 z-10 flex flex-col items-center justify-center gap-1.5 rounded-full bg-snow/85 px-4 text-center backdrop-blur dark:bg-dark-card/85">
            <p className="text-caption text-ink-500 dark:text-dark-text/70">朗读暂时无法播放</p>
            <button onClick={retry} className="rounded-full border border-celadon/50 px-3 py-0.5 text-caption text-celadon-700 transition active:scale-95 dark:text-celadon-300">重试</button>
          </div>
        ) : buffering ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <MediaSpinner />
          </div>
        ) : null}
      </div>

      <h3 className="mt-4 font-serif text-lg text-ink dark:text-dark-text">{book.title}</h3>
      <p className="text-xs text-ink-500 dark:text-dark-text/55">{book.author} · 全本朗读</p>

      <div className="mt-4 flex w-full max-w-[320px] items-center gap-2">
        <span className="w-10 text-right text-caption text-ink-500 tabular-nums dark:text-dark-text/55">{formatTime(cur)}</span>
        <Scrubber value={cur} max={dur} onSeek={(t) => { if (ref.current) ref.current.currentTime = t; }} />
        <span className="w-10 text-caption text-ink-500 tabular-nums dark:text-dark-text/55">{formatTime(dur)}</span>
      </div>

      {/* 后退15s / 环形播放键 / 前进15s */}
      <div className="mt-4 flex items-center gap-8">
        <button onClick={() => skip(-15)} aria-label="后退15秒" className="flex flex-col items-center text-ink-500 dark:text-dark-text/70">
          <Rewind size={24} />
          <span className="text-micro">15s</span>
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
          <span className="text-micro">15s</span>
        </button>
      </div>

      <div className="mt-3">
        <SpeedPills speed={speed} onChange={setSpeed} />
      </div>
    </div>
  );
}
