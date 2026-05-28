"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Heart, Bookmark, MessageSquare, ArrowRight, Play } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Avatar } from "@/components/ui/Avatar";
import { getFlip } from "@/lib/api";
import { formatCount } from "@/lib/utils";
import { useAuth, useLibrary, useUI, requireLogin } from "@/lib/store";
import type { Book } from "@/lib/types";

export default function FlipPage() {
  const { data, isLoading } = useQuery({ queryKey: ["flip"], queryFn: () => getFlip([]) });
  const books = data ?? [];

  return (
    <main className="h-[100dvh] overflow-hidden bg-black">
      {isLoading ? (
        <div className="flex h-full items-center justify-center text-white/50">加载中…</div>
      ) : (
        <div className="h-full snap-y snap-mandatory overflow-y-auto no-scrollbar">
          {books.map((b, i) => (
            <FlipSlide key={`${b.id}-${i}`} book={b} />
          ))}
        </div>
      )}
      <BottomNav active="flip" />
    </main>
  );
}

function FlipSlide({ book }: { book: Book }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [liked, setLiked] = useState(false);
  const [burst, setBurst] = useState(false);
  const [err, setErr] = useState(false);
  const isFav = useLibrary((s) => s.isFav);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const toast = useUI((s) => s.toast);
  const user = useAuth((s) => s.user);
  const fav = user ? isFav(book.id) : false;

  useEffect(() => {
    const el = ref.current;
    const v = videoRef.current;
    if (!el || !v) return;
    const ob = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e.isIntersecting) {
          v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
          v.pause();
          v.currentTime = 0;
        }
      },
      { threshold: 0.6 }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  function tapToggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }

  function like() {
    requireLogin(() => {
      setLiked((l) => !l);
      setBurst(true);
      setTimeout(() => setBurst(false), 600);
    });
  }

  return (
    <div ref={ref} className="relative h-[100dvh] w-full snap-start snap-always bg-black">
      {/* 视频 */}
      {!err ? (
        <video
          ref={videoRef}
          src={book.videoUrl}
          className="h-full w-full object-cover"
          loop
          muted
          playsInline
          onClick={tapToggle}
          onDoubleClick={like}
          onError={() => setErr(true)}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white/70">
          <p>这本书的视频暂时无法播放</p>
          <button onClick={() => router.push(`/library/book/${book.id}`)} className="rounded-full bg-celadon px-5 py-2 text-sm text-white">
            看图文详情
          </button>
        </div>
      )}

      {/* 暂停指示 */}
      {!playing && !err && (
        <button onClick={tapToggle} className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 backdrop-blur">
            <Play size={30} className="ml-1 text-white" />
          </span>
        </button>
      )}

      {/* 双击点赞迸发 */}
      {burst && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Heart size={120} className="animate-[scale-in_0.6s_ease-out] fill-rouge text-rouge drop-shadow-lg" />
        </div>
      )}

      {/* 渐变 + 信息浮层 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
      <div className="absolute bottom-0 left-0 right-16 px-4 pb-[82px]">
        <h2 className="font-serif text-2xl text-white drop-shadow">{book.title}</h2>
        <p className="mt-1 text-sm text-white/80">{book.author}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {book.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur">{t}</span>
          ))}
        </div>
        <p className="mt-2 text-sm text-white/85">{book.intro}</p>
        <button
          onClick={() => router.push(`/library/book/${book.id}/read`)}
          className="mt-3 inline-flex items-center gap-1 rounded-full bg-celadon px-4 py-2 text-sm font-medium text-white shadow-celadon active:scale-95"
        >
          读这本书 <ArrowRight size={14} />
        </button>
      </div>

      {/* 右侧操作栏 */}
      <div className="absolute bottom-[88px] right-3 flex flex-col items-center gap-5">
        <Avatar seed={book.coverSeed} name={book.author} size={44} className="ring-2 ring-celadon" />
        <Action icon={<Heart size={28} className={liked ? "fill-rouge text-rouge" : "text-white"} />} label={formatCount(248000 + (liked ? 1 : 0))} onClick={like} />
        <Action
          icon={<Bookmark size={28} className={fav ? "fill-brass text-brass" : "text-white"} />}
          label={formatCount(86000)}
          onClick={() => requireLogin(() => { const n = toggleFav(book.id); toast(n ? "已收藏" : "已取消收藏"); })}
        />
        <Action icon={<MessageSquare size={28} className="text-white" />} label={formatCount(12000)} onClick={() => requireLogin(() => router.push(`/library/book/${book.id}/review/new`))} />
      </div>
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 active:scale-90">
      {icon}
      <span className="text-[11px] text-white/90">{label}</span>
    </button>
  );
}
