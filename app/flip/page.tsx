"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Heart, MessageSquare, ArrowRight, Play, Volume2, VolumeX } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Motif } from "@/components/ui/Motif";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { getFlip } from "@/lib/api";
import { useLibrary, useUI, requireLogin } from "@/lib/store";
import { useReadingClock } from "@/lib/useReadingClock";
import type { Book } from "@/lib/types";

// 模块级缓存：离开乱翻（如去写书评）再返回时，保持同一视频流与所在位置
let flipCache: { books: Book[]; idx: number } | null = null;

export default function FlipPage() {
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>(flipCache?.books ?? []);
  const [loading, setLoading] = useState(!flipCache);
  const [error, setError] = useState(false);
  const [soundOn, setSoundOn] = useState(true); // 用户想要声音（默认要）
  const [mutedNow, setMutedNow] = useState(false); // 当前视频「实际」是否静音 → 喇叭图标据此显示
  const [activeIdx, setActiveIdx] = useState(flipCache?.idx ?? 0);
  const [loaded, setLoaded] = useState(false); // 当前视频可播放（缓冲完成）
  const [playing, setPlaying] = useState(false); // 当前视频在播
  const [vErr, setVErr] = useState(false); // 当前视频加载失败

  const fetching = useRef(false);
  const booksRef = useRef<Book[]>(books);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null); // 全程唯一复用的 <video>（永不卸载/新建 → 永远只占 1 个解码器）
  const activeIdxRef = useRef(activeIdx);
  const soundOnRef = useRef(soundOn);
  const mutedNowRef = useRef(mutedNow);
  const userPausedRef = useRef(false); // 用户是否主动暂停当前视频
  const lastT = useRef<number | null>(null);
  const playedSec = useRef(0);
  const lastReport = useRef(0);

  const setMediaPlayed = useLibrary((s) => s.setMediaPlayed);
  const pushHistory = useLibrary((s) => s.pushHistory);

  useEffect(() => { booksRef.current = books; }, [books]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { mutedNowRef.current = mutedNow; }, [mutedNow]);
  useReadingClock(playing && !vErr); // 单视频：仅在播放时计时（天然只有一条，无多倍计时问题）

  // 写历史（针对当前 active 书）
  const writeMedia = useCallback((force = false) => {
    const v = videoRef.current;
    const b = booksRef.current[activeIdxRef.current];
    if (!v || !v.duration || !b) return;
    const rid = b.id.split("__")[0];
    const played = useLibrary.getState().mediaPlayed[rid] ?? 0;
    if (played <= 0) return;
    const now = Date.now();
    if (!force && now - lastReport.current < 5000) return;
    lastReport.current = now;
    const prog = played >= 0.9 ? 100 : Math.round(played * 100);
    pushHistory({ bookId: rid, bookTitle: b.title, author: b.author, coverSeed: b.coverSeed, cover: b.cover, mode: "video", progress: prog, lastAt: new Date().toISOString() });
  }, [pushHistory]);

  // 播放当前视频：带声被拦则静音兜底（绝不停在暂停）；同步真实静音态给喇叭图标
  const playActive = useCallback(() => {
    const v = videoRef.current;
    if (!v || userPausedRef.current) return;
    v.muted = !soundOnRef.current;
    setMutedNow(v.muted);
    v.play().then(() => setMutedNow(v.muted)).catch(() => {
      v.muted = true;
      setMutedNow(true);
      v.play().catch(() => {});
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    getFlip([])
      .then((b) => { setBooks(b); setLoading(false); flipCache = { books: b, idx: 0 }; })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  // 首次进入：加载；从缓存返回：恢复到离开时的视频
  useEffect(() => {
    if (flipCache && flipCache.books.length) {
      const idx = flipCache.idx;
      requestAnimationFrame(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = idx * el.clientHeight;
      });
      return;
    }
    load();
  }, [load]);

  const loadMore = useCallback(() => {
    if (fetching.current) return;
    fetching.current = true;
    getFlip(booksRef.current.map((b) => b.id))
      .then((more) => setBooks((cur) => {
        const next = [...cur, ...more];
        if (flipCache) flipCache.books = next;
        return next;
      }))
      .finally(() => { fetching.current = false; });
  }, []);

  useEffect(() => {
    if (!loading && books.length && activeIdx >= books.length - 2) loadMore();
  }, [activeIdx, books.length, loading, loadMore]);

  // 切到新条：先落上一条进度 → 同一个 video 换源 → 播（绝不新建 video 元素）
  useEffect(() => {
    const v = videoRef.current;
    const b = books[activeIdx];
    if (loading || !b) return;
    writeMedia(true); // flush 上一条（此刻 activeIdxRef 仍是旧值）
    activeIdxRef.current = activeIdx;
    if (flipCache) flipCache.idx = activeIdx;
    lastT.current = null;
    userPausedRef.current = false;
    setVErr(false);
    setPlaying(false);
    if (v && b.videoUrl) {
      if (v.getAttribute("src") !== b.videoUrl) { setLoaded(false); v.src = b.videoUrl; v.load(); }
      playActive();
    }
  }, [activeIdx, books, loading, writeMedia, playActive]);

  const onActive = useCallback((i: number) => { setActiveIdx(i); }, []);

  // 当前条由滚动落点决定（snap 落定即准）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || loading || !books.length) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const h = el.clientHeight || 1;
      const i = Math.max(0, Math.min(Math.round(el.scrollTop / h), booksRef.current.length - 1));
      if (i !== activeIdxRef.current) onActive(i);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", compute);
    return () => { el.removeEventListener("scroll", onScroll); el.removeEventListener("scrollend", compute); if (raf) cancelAnimationFrame(raf); };
  }, [loading, books.length, onActive]);

  // 任意手势同步触发播放（微信只认手势内 play → 带声解锁）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const kick = () => playActive();
    el.addEventListener("pointerdown", kick, { passive: true });
    el.addEventListener("touchstart", kick, { passive: true });
    return () => { el.removeEventListener("pointerdown", kick); el.removeEventListener("touchstart", kick); };
  }, [playActive, books.length, loading]);

  // 微信内置浏览器(X5)默认禁止自动播放，等 JS 桥就绪后触发
  useEffect(() => {
    if (loading || !books.length) return;
    const kick = () => playActive();
    if (typeof window !== "undefined" && "WeixinJSBridge" in window) kick();
    else document.addEventListener("WeixinJSBridgeReady", kick, { once: true });
    return () => document.removeEventListener("WeixinJSBridgeReady", kick);
  }, [loading, books.length, playActive]);

  const toggleSound = useCallback(() => {
    const turnOn = mutedNowRef.current; // 当前静音 → 开声音；当前有声 → 静音
    setSoundOn(turnOn);
    const v = videoRef.current;
    if (v) {
      v.muted = !turnOn;
      setMutedNow(!turnOn);
      if (turnOn) { userPausedRef.current = false; v.play().catch(() => {}); }
    }
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { userPausedRef.current = false; v.play().catch(() => {}); }
    else { userPausedRef.current = true; v.pause(); }
  }, []);

  function onTime(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget;
    const b = booksRef.current[activeIdxRef.current];
    if (!b) return;
    const cur = v.currentTime;
    const dur = v.duration || 0;
    if (dur <= 0) return;
    const rid = b.id.split("__")[0];
    if (lastT.current !== null) {
      const d = cur - lastT.current;
      if (d > 0 && d < 1.5) { playedSec.current += d; setMediaPlayed(rid, playedSec.current / dur); } // 真实观看覆盖（仅正常前进）
    }
    lastT.current = cur;
    writeMedia();
  }

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-dark-bg">
      <div className="absolute inset-x-0 top-0" style={{ bottom: "calc(3.75rem + env(safe-area-inset-bottom))" }}>
        {loading ? (
          <FlipSkeleton />
        ) : error ? (
          <div className="flex h-full items-center justify-center text-dark-text">
            <ErrorState title="内容加载失败" subtitle="请检查网络后重试" onRetry={load} />
          </div>
        ) : books.length === 0 ? (
          <div className="flex h-full items-center justify-center text-dark-text">
            <EmptyState icon="book" title="暂无视频解读" subtitle="去泡馆挑一本书读读吧" actionText="去泡馆逛逛" actionHref="/library" />
          </div>
        ) : (
          <>
            {/* 唯一视频：固定铺底、全程复用换源、绝不卸载 → 永远只占 1 个解码器 */}
            {!vErr ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                ref={videoRef}
                className="absolute inset-0 z-0 h-full w-full object-cover"
                loop
                playsInline
                onTimeUpdate={onTime}
                onCanPlay={() => setLoaded(true)}
                onPlay={() => setPlaying(true)}
                onPlaying={() => { setLoaded(true); setPlaying(true); }}
                onWaiting={() => setLoaded(false)}
                onPause={() => { setPlaying(false); lastT.current = null; writeMedia(true); }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  const b = booksRef.current[activeIdxRef.current];
                  if (b && v.duration) { const rid = b.id.split("__")[0]; playedSec.current = (useLibrary.getState().mediaPlayed[rid] ?? 0) * v.duration; }
                }}
                onError={() => { if (videoRef.current?.getAttribute("src")) setVErr(true); }}
              />
            ) : (
              <div className="absolute inset-0 z-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-dark-text/70">
                <Motif name="cloud" className="relative w-24 text-celadon/20" />
                <p className="relative">这本书的视频暂时无法播放</p>
                <button onClick={() => { const b = books[activeIdx]; if (b) router.push(`/library/book/${b.id.split("__")[0]}`); }} className="relative rounded-full border border-celadon/50 bg-white/8 px-5 py-2 text-sm text-celadon-300 backdrop-blur-md active:scale-95">看图文详情</button>
              </div>
            )}

            {/* 缓冲加载页（当前视频） */}
            {!vErr && !loaded && (
              <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3">
                <span className="h-11 w-11 animate-spin rounded-full border-2 border-white/15 border-t-celadon" />
                <span className="text-xs tracking-wide text-dark-text/55">视频加载中…</span>
              </div>
            )}

            {/* 暂停时的播放按钮（仅中央小圆可点，四周落到滚动层不挡操作） */}
            {!vErr && !playing && loaded && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <button onClick={togglePlay} aria-label="播放" className="pointer-events-auto flex h-16 w-16 animate-scale-in items-center justify-center rounded-full bg-black/35 ring-1 ring-celadon/40 backdrop-blur-md">
                  <Play size={28} className="ml-1 text-dark-text" />
                </button>
              </div>
            )}

            {/* 滚动容器：每条仅 overlay（透明，露出底层视频），负责 snap 与当前条侦测 */}
            <div ref={scrollerRef} className="absolute inset-0 z-10 snap-y snap-mandatory overflow-y-auto overscroll-contain no-scrollbar">
              {books.map((b) => (
                <FlipSlide key={b.id} book={b} onTogglePlay={togglePlay} />
              ))}
            </div>

            {/* 顶部装饰短线 */}
            <div className="pointer-events-none absolute left-1/2 z-20 h-px w-16 -translate-x-1/2 bg-gradient-to-r from-transparent via-brass/70 to-transparent" style={{ top: "calc(env(safe-area-inset-top) + 10px)" }} />
            {/* 喇叭（页面级，控制唯一视频；图标反映实际静音态） */}
            <button
              onClick={toggleSound}
              aria-label={mutedNow ? "开启声音" : "静音"}
              className="absolute right-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-dark-text/90 ring-1 ring-brass/30 backdrop-blur-md transition active:scale-90"
              style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
            >
              {mutedNow ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          </>
        )}
      </div>
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
        <div className="skeleton h-11 w-11 rounded-full" />
        <div className="skeleton h-11 w-11 rounded-full" />
      </div>
      <div className="skeleton absolute bottom-24 right-3 h-10 w-28 rounded-full" />
    </div>
  );
}

// 每条仅渲染叠加层（文字/收藏/书评/渐变/点击层），不含 video。视频由页面级单元素统一承载。
function FlipSlide({ book, onTogglePlay }: { book: Book; onTogglePlay: () => void }) {
  const router = useRouter();
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const myReviews = useLibrary((s) => s.myReviews);
  const toast = useUI((s) => s.toast);
  const realId = book.id.split("__")[0];
  const fav = favorites.includes(realId);

  function triggerBurst() {
    setBurst((n) => n + 1);
    setTimeout(() => setBurst((n) => Math.max(0, n - 1)), 800);
  }
  function favOnly() {
    requireLogin(() => {
      if (!useLibrary.getState().isFav(realId)) { toggleFav(realId); toast("已收藏"); }
      triggerBurst();
    });
  }
  function onTap() {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = 0;
      favOnly();
    } else {
      lastTap.current = now;
      tapTimer.current = setTimeout(() => { onTogglePlay(); lastTap.current = 0; }, 280);
    }
  }
  function openReview() { requireLogin(() => router.push(`/library/book/${realId}/review/new`)); }

  return (
    <div className="relative h-full w-full snap-start snap-always overflow-hidden">
      {/* 透明点击层：单击播放/暂停，双击收藏 */}
      <button className="absolute inset-0 z-0" onClick={onTap} aria-label="播放 / 暂停" />

      {burst > 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="absolute h-28 w-28 animate-like-burst rounded-full bg-rouge/25 blur-md" />
          <Heart size={120} className="animate-like-burst fill-rouge text-rouge drop-shadow-[0_4px_16px_rgba(168,66,58,0.5)]" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-dark-bg/85 via-dark-bg/15 to-transparent" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 80% at 50% 42%, transparent 55%, rgba(0,0,0,0.4))" }} />
      <Motif name="branch" className="pointer-events-none absolute bottom-28 -left-4 w-28 text-brass/10" />

      {/* 右侧操作栏：收藏 + 书评 */}
      <div className="absolute right-3 z-10 flex flex-col items-center gap-6" style={{ bottom: "150px" }}>
        <Action
          icon={<Heart size={30} className={fav ? "fill-rouge text-rouge" : "text-dark-text"} />}
          ariaLabel={fav ? "已收藏" : "收藏"}
          pressed={fav}
          onClick={() => requireLogin(() => { const n = toggleFav(realId); toast(n ? "已收藏" : "已取消收藏"); if (n) triggerBurst(); })}
        />
        <Action
          icon={<MessageSquare size={28} className="text-dark-text" />}
          ariaLabel={myReviews.some((r) => r.bookId === realId) ? "编辑书评" : "写书评"}
          onClick={openReview}
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 px-4" style={{ paddingBottom: "16px" }}>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[19px] leading-snug tracking-wide text-dark-text drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]">{book.title}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {book.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full border border-brass/30 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-dark-text/90 backdrop-blur-md">{t}</span>
            ))}
          </div>
          <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-dark-text/85">{book.intro}</p>
        </div>
        <button
          onClick={() => router.push(`/library/book/${realId}`)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-celadon/80 px-4 py-2 text-[13px] font-medium text-white ring-1 ring-white/25 backdrop-blur-md transition active:scale-95"
        >
          读这本书 <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Action({ icon, label, onClick, ariaLabel, pressed }: { icon: React.ReactNode; label?: string; onClick: () => void; ariaLabel: string; pressed?: boolean }) {
  return (
    <button onClick={onClick} aria-label={ariaLabel} aria-pressed={pressed} className="flex flex-col items-center gap-1 transition active:scale-90">
      <span className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">{icon}</span>
      {label && (
        <motion.span key={label} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.18 }} className="text-[11px] font-medium tabular-nums text-dark-text drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
          {label}
        </motion.span>
      )}
    </button>
  );
}
