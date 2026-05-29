"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Heart, MessageSquare, ArrowRight, Play, Volume2, VolumeX } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Motif } from "@/components/ui/Motif";
import { getFlip } from "@/lib/api";
import { formatCount } from "@/lib/utils";
import { useLibrary, useUI, requireLogin } from "@/lib/store";
import type { Book } from "@/lib/types";

export default function FlipPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const fetching = useRef(false);

  useEffect(() => {
    getFlip([]).then((b) => { setBooks(b); setLoading(false); });
  }, []);

  const loadMore = useCallback(() => {
    if (fetching.current) return;
    fetching.current = true;
    setBooks((prev) => {
      getFlip(prev.map((b) => b.id)).then((more) => {
        setBooks((cur) => [...cur, ...more]);
        fetching.current = false;
      });
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!loading && books.length && activeIdx >= books.length - 2) loadMore();
  }, [activeIdx, books.length, loading, loadMore]);

  return (
    <main className="h-[100dvh] overflow-hidden bg-dark-bg">
      {loading ? (
        <FlipSkeleton />
      ) : (
        <div className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain no-scrollbar">
          {books.map((b, i) => (
            <FlipSlide key={b.id} book={b} muted={muted} onMute={() => setMuted((m) => !m)} onActive={() => setActiveIdx(i)} />
          ))}
        </div>
      )}
      <BottomNav active="flip" variant="dark" />
    </main>
  );
}

function FlipSkeleton() {
  return (
    <div className="relative h-full w-full bg-gradient-to-b from-dark-card to-dark-bg">
      <Motif name="mountain" className="absolute left-1/2 top-1/3 w-48 -translate-x-1/2 text-celadon/15" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-dark-bg/85 to-transparent" />
      <div className="absolute bottom-28 left-4 right-20 space-y-2.5">
        <div className="skeleton h-7 w-44 rounded" />
        <div className="skeleton h-4 w-24 rounded" />
        <div className="skeleton h-4 w-56 rounded" />
      </div>
      <div className="absolute bottom-44 right-3 flex flex-col items-center gap-6">
        <div className="skeleton h-14 w-11 rounded-xl" />
        <div className="skeleton h-11 w-11 rounded-full" />
        <div className="skeleton h-11 w-11 rounded-full" />
      </div>
      <div className="skeleton absolute bottom-24 right-3 h-10 w-28 rounded-full" />
    </div>
  );
}

function FlipSlide({ book, muted, onMute, onActive }: { book: Book; muted: boolean; onMute: () => void; onActive: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const [burst, setBurst] = useState(0);
  const [err, setErr] = useState(false);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const toast = useUI((s) => s.toast);
  const realId = book.id.split("__")[0];
  const fav = favorites.includes(realId);

  useEffect(() => {
    const el = ref.current;
    const v = videoRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e.isIntersecting) {
          onActive();
          v?.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else if (v) {
          v.pause();
          v.currentTime = 0;
        }
      },
      { threshold: 0.6 }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []); // eslint-disable-line

  function triggerBurst() {
    setBurst((n) => n + 1);
    setTimeout(() => setBurst((n) => Math.max(0, n - 1)), 800);
  }
  function favOnly() {
    requireLogin(() => {
      if (!fav) { toggleFav(realId); toast("已收藏"); }
      triggerBurst();
    });
  }
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  }
  function onTap() {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = 0;
      favOnly();
    } else {
      lastTap.current = now;
      tapTimer.current = setTimeout(() => { togglePlay(); lastTap.current = 0; }, 280);
    }
  }

  return (
    <div ref={ref} className="relative h-[100dvh] w-full snap-start snap-always overflow-hidden bg-dark-bg">
      {!err ? (
        <>
          <video
            ref={videoRef}
            src={book.videoUrl}
            poster={book.posterUrl}
            className="h-full w-full object-cover"
            loop
            muted={muted}
            playsInline
            onClick={onTap}
            onCanPlay={() => setReady(true)}
            onError={() => setErr(true)}
          />
          {/* 海报首帧 → 视频 淡入交接（消黑闪） */}
          {book.posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.posterUrl}
              alt=""
              className={"pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500 " + (ready ? "opacity-0" : "opacity-100")}
            />
          )}
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-dark-text/70">
          {book.posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={book.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
          )}
          <Motif name="cloud" className="relative w-24 text-celadon/20" />
          <p className="relative">这本书的视频暂时无法播放</p>
          <button onClick={() => router.push(`/library/book/${realId}`)} className="relative rounded-full border border-celadon/50 bg-white/8 px-5 py-2 text-sm text-celadon-300 backdrop-blur-md active:scale-95">看图文详情</button>
        </div>
      )}

      {/* 暂停指示 */}
      {!playing && !err && (
        <button onClick={togglePlay} aria-label="播放" className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 animate-scale-in items-center justify-center rounded-full bg-black/35 ring-1 ring-celadon/40 backdrop-blur-md">
            <Play size={28} className="ml-1 text-dark-text" />
          </span>
        </button>
      )}

      {/* 顶部画框黄铜线 */}
      <div className="pointer-events-none absolute left-1/2 z-10 h-px w-16 -translate-x-1/2 bg-gradient-to-r from-transparent via-brass/70 to-transparent" style={{ top: "calc(env(safe-area-inset-top) + 10px)" }} />

      {/* 静音切换（暖玻璃描边） */}
      <button
        onClick={onMute}
        aria-label={muted ? "取消静音" : "静音"}
        className="absolute right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-dark-text/90 ring-1 ring-brass/30 backdrop-blur-md transition active:scale-90"
        style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      {/* 双击点赞 · 墨痕迸发 */}
      {burst > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="absolute h-28 w-28 animate-like-burst rounded-full bg-rouge/25 blur-md" />
          <Heart size={120} className="animate-like-burst fill-rouge text-rouge drop-shadow-[0_4px_16px_rgba(168,66,58,0.5)]" />
        </div>
      )}

      {/* 影院双层渐变 + 四角暗角 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-dark-bg/92 via-dark-bg/35 to-transparent" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 80% at 50% 42%, transparent 55%, rgba(0,0,0,0.4))" }} />
      <Motif name="branch" className="pointer-events-none absolute bottom-28 -left-4 w-28 text-brass/10" />

      {/* 右侧操作栏：收藏 + 书评（书封入口已并入「读这本书」，避免重复进详情）*/}
      <div
        className="absolute right-3 z-10 flex flex-col items-center gap-6"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 232px)" }}
      >
        <Action
          icon={<Heart size={30} className={fav ? "fill-rouge text-rouge" : "text-dark-text"} />}
          label={formatCount(book.favCount + (fav ? 1 : 0))}
          ariaLabel={fav ? "已收藏" : "收藏"}
          pressed={fav}
          onClick={() => requireLogin(() => { const n = toggleFav(realId); toast(n ? "已收藏" : "已取消收藏"); if (n) triggerBurst(); })}
        />
        <Action
          icon={<MessageSquare size={28} className="text-dark-text" />}
          label={formatCount(book.reviewCount)}
          ariaLabel="查看书评"
          onClick={() => router.push(`/library/book/${realId}/reviews`)}
        />
      </div>

      {/* 底部：信息题跋（左）+「读这本书」（右）· 同行底部对齐 */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 px-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 74px)" }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-start">
            <span className="mr-2 mt-1.5 h-6 w-0.5 shrink-0 rounded-full bg-celadon/80" />
            <h2 className="font-serif text-[26px] leading-[1.15] tracking-wide text-dark-text drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">{book.title}</h2>
          </div>
          <p className="mt-1.5 text-[13px] text-dark-text/70">{book.author} · {book.category}解读</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {book.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full border border-brass/30 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-dark-text/90 backdrop-blur-md">{t}</span>
            ))}
          </div>
          <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-dark-text/85">{book.intro}</p>
        </div>
        <button
          onClick={() => router.push(`/library/book/${realId}`)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-celadon px-5 py-2.5 text-sm font-medium text-white shadow-celadon ring-1 ring-brass/40 transition active:scale-95"
        >
          读这本书 <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Action({
  icon,
  label,
  onClick,
  ariaLabel,
  pressed,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  ariaLabel: string;
  pressed?: boolean;
}) {
  return (
    <button onClick={onClick} aria-label={ariaLabel} aria-pressed={pressed} className="flex flex-col items-center gap-1 transition active:scale-90">
      <span className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">{icon}</span>
      <motion.span
        key={label}
        initial={{ y: 6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="text-[11px] font-medium tabular-nums text-dark-text drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]"
      >
        {label}
      </motion.span>
    </button>
  );
}
