"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, MessageSquare, ArrowRight, Play, Volume2, VolumeX, BookOpen } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { BookCover } from "@/components/ui/BookCover";
import { getFlip } from "@/lib/api";
import { formatCount } from "@/lib/utils";
import { useAuth, useLibrary, useUI, requireLogin } from "@/lib/store";
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
    <main className="h-[100dvh] overflow-hidden bg-black">
      {loading ? (
        <FlipSkeleton />
      ) : (
        <div className="h-full snap-y snap-mandatory overflow-y-auto no-scrollbar">
          {books.map((b, i) => (
            <FlipSlide key={b.id} book={b} index={i} muted={muted} onMute={() => setMuted((m) => !m)} onActive={() => setActiveIdx(i)} />
          ))}
        </div>
      )}
      <BottomNav active="flip" variant="dark" />
    </main>
  );
}

function FlipSkeleton() {
  return (
    <div className="relative h-full w-full bg-gradient-to-b from-dark-card to-black">
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
      <div className="absolute bottom-24 left-4 right-16 space-y-2">
        <div className="skeleton h-7 w-40 rounded" />
        <div className="skeleton h-4 w-24 rounded" />
        <div className="skeleton h-4 w-56 rounded" />
      </div>
      <div className="absolute bottom-28 right-3 flex flex-col items-center gap-5">
        <div className="skeleton h-14 w-11 rounded-xl" />
        <div className="skeleton h-11 w-11 rounded-full" />
        <div className="skeleton h-11 w-11 rounded-full" />
      </div>
    </div>
  );
}

function FlipSlide({ book, index, muted, onMute, onActive }: { book: Book; index: number; muted: boolean; onMute: () => void; onActive: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [burst, setBurst] = useState(0);
  const [err, setErr] = useState(false);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const toast = useUI((s) => s.toast);
  const user = useAuth((s) => s.user);
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
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
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
    <div ref={ref} className="relative h-[100dvh] w-full snap-start snap-always bg-black">
      {/* 视频（海报作首帧/封面） */}
      {!err ? (
        <video
          ref={videoRef}
          src={book.videoUrl}
          poster={book.posterUrl}
          className="h-full w-full object-cover"
          loop
          muted={muted}
          playsInline
          onClick={onTap}
          onError={() => setErr(true)}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white/70">
          {/* 海报兜底背景 */}
          {book.posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={book.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
          )}
          <p className="relative">这本书的视频暂时无法播放</p>
          <button onClick={() => router.push(`/library/book/${realId}`)} className="relative rounded-full bg-celadon px-5 py-2 text-sm text-white">看图文详情</button>
        </div>
      )}

      {/* 暂停指示 */}
      {!playing && !err && (
        <button onClick={togglePlay} aria-label="播放" className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 backdrop-blur">
            <Play size={30} className="ml-1 text-white" />
          </span>
        </button>
      )}

      {/* 静音切换 */}
      <button onClick={onMute} aria-label={muted ? "取消静音" : "静音"} className="absolute right-3 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur">
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      {/* 双击点赞迸发 */}
      {burst > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Heart size={120} className="animate-like-burst fill-rouge text-rouge drop-shadow-lg" />
        </div>
      )}

      {/* 柔和渐变 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

      {/* 信息浮层 */}
      <div className="absolute bottom-0 left-0 right-[76px] px-4 pb-[84px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-celadon/85 px-2.5 py-0.5 text-[11px] font-medium text-white shadow backdrop-blur">
          <BookOpen size={11} /> {book.category}解读
        </span>
        <h2 className="mt-2 font-serif text-[26px] leading-tight text-white drop-shadow-md">{book.title}</h2>
        <p className="mt-1 text-sm text-white/75">{book.author}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {book.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur">{t}</span>
          ))}
        </div>
        <p className="mt-2.5 line-clamp-2 text-[13px] leading-5 text-white/85">{book.intro}</p>
        <button
          onClick={() => router.push(`/library/book/${realId}/read`)}
          className="mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-celadon px-5 py-2.5 text-sm font-medium text-white shadow-celadon ring-1 ring-white/20 active:scale-95"
        >
          读这本书 <ArrowRight size={15} />
        </button>
      </div>

      {/* 右侧操作栏：书封缩略（进详情）+ 收藏 + 书评 */}
      <div className="absolute bottom-[92px] right-3 flex flex-col items-center gap-5">
        <button onClick={() => router.push(`/library/book/${realId}`)} aria-label="书籍详情" className="active:scale-95">
          <BookCover title={book.title} seed={book.coverSeed} src={book.cover} showText={false} rounded="rounded-xl" className="w-11 shadow-lg ring-2 ring-white/40" />
        </button>
        <Action
          icon={<Heart size={28} className={fav ? "fill-rouge text-rouge" : "text-white"} />}
          label={formatCount(book.favCount + (fav ? 1 : 0))}
          ariaLabel={fav ? "已收藏" : "收藏"}
          pressed={fav}
          onClick={() => requireLogin(() => { const n = toggleFav(realId); toast(n ? "已收藏" : "已取消收藏"); if (n) triggerBurst(); })}
        />
        <Action
          icon={<MessageSquare size={28} className="text-white" />}
          label={formatCount(book.reviewCount)}
          ariaLabel="查看书评"
          onClick={() => router.push(`/library/book/${realId}/reviews`)}
        />
      </div>
    </div>
  );
}

function Action({ icon, label, onClick, ariaLabel, pressed }: { icon: React.ReactNode; label: string; onClick: () => void; ariaLabel: string; pressed?: boolean }) {
  return (
    <button onClick={onClick} aria-label={ariaLabel} aria-pressed={pressed} className="flex flex-col items-center gap-1 active:scale-90">
      {icon}
      <span className="text-[11px] text-white/90">{label}</span>
    </button>
  );
}
