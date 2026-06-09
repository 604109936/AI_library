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
  const [books, setBooks] = useState<Book[]>(flipCache?.books ?? []);
  const [loading, setLoading] = useState(!flipCache);
  const [error, setError] = useState(false);
  const [soundOn, setSoundOn] = useState(true); // 用户想要声音（默认要）
  const [mutedNow, setMutedNow] = useState(false); // 当前条视频「实际」是否静音 → 喇叭图标据此显示（诚实）
  const [activeIdx, setActiveIdx] = useState(flipCache?.idx ?? 0);
  const fetching = useRef(false);
  const booksRef = useRef<Book[]>(books);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const videosRef = useRef<(HTMLVideoElement | null)[]>([]); // 各条视频元素，集中控制播放/静音
  const userPausedRef = useRef<boolean[]>([]); // 各条「是否被用户主动暂停」（页面级单一来源，playActive 据此不强行重播）
  const activeIdxRef = useRef(activeIdx);
  const soundOnRef = useRef(soundOn);
  const mutedNowRef = useRef(mutedNow);
  useEffect(() => { booksRef.current = books; }, [books]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { mutedNowRef.current = mutedNow; }, [mutedNow]);

  const registerVideo = useCallback((i: number, el: HTMLVideoElement | null) => { videosRef.current[i] = el; }, []);
  const onActive = useCallback((i: number) => { setActiveIdx(i); if (flipCache) flipCache.idx = i; }, []);

  // 播放当前条、暂停其余；尊重用户主动暂停；带声被浏览器拦时静音兜底（绝不停在暂停）；同步「实际静音态」给喇叭图标
  const playActive = useCallback(() => {
    const i = activeIdxRef.current;
    videosRef.current.forEach((vid, j) => { if (vid && j !== i && !vid.paused) vid.pause(); });
    const v = videosRef.current[i];
    if (!v) return;
    if (userPausedRef.current[i]) return; // 用户主动暂停的当前条：kick/切条都不强行重播
    v.muted = !soundOnRef.current;
    setMutedNow(v.muted);
    v.play().then(() => setMutedNow(v.muted)).catch(() => {
      // 带声自动播放被浏览器拦截 → 静音继续播，绝不停在暂停态（用户下次手势会在 kick 内带声解锁）
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

  // 当前条由「滚动落点」决定（snap 落定即准），比 IntersectionObserver 阈值更可靠，避免快速滑动漏报、旧条声音残留
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

  // 切到新条：清掉该条「用户暂停」意图(切条默认自动播放) + 立即播放（处于上滑手势激活窗口内，带声大概率被允许）
  useEffect(() => {
    activeIdxRef.current = activeIdx;
    userPausedRef.current[activeIdx] = false;
    if (!loading && books.length) playActive();
  }, [activeIdx, loading, books.length, playActive]);

  // 任意手势（点击 / 上滑）同步触发一次播放：手机/微信只认「手势内 play」→ 借此带声解锁；playActive 已尊重 userPaused，不会强行唤醒被暂停的条
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const kick = () => playActive();
    el.addEventListener("pointerdown", kick, { passive: true });
    el.addEventListener("touchstart", kick, { passive: true });
    return () => { el.removeEventListener("pointerdown", kick); el.removeEventListener("touchstart", kick); };
  }, [playActive, books.length, loading]);

  // 微信内置浏览器(X5)默认禁止自动播放(连静音也拦)，需等微信 JS 桥就绪后触发，方能「进入即播」而非停在播放按钮
  useEffect(() => {
    if (loading || !books.length) return;
    const kick = () => playActive();
    if (typeof window !== "undefined" && "WeixinJSBridge" in window) kick();
    else document.addEventListener("WeixinJSBridgeReady", kick, { once: true });
    return () => document.removeEventListener("WeixinJSBridgeReady", kick);
  }, [loading, books.length, playActive]);

  // 喇叭：在用户点击（真实手势）里同步开/关声音；开声音时立即 play，确保必出声
  const toggleSound = useCallback(() => {
    const turnOn = mutedNowRef.current; // 当前静音 → 开声音；当前有声 → 静音
    setSoundOn(turnOn);
    const v = videosRef.current[activeIdxRef.current];
    if (v) {
      v.muted = !turnOn;
      setMutedNow(!turnOn);
      if (turnOn) { userPausedRef.current[activeIdxRef.current] = false; v.play().catch(() => {}); }
    }
  }, []);

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-dark-bg">
      {/* 视频区：占满底栏以上的空间，底栏不再压在视频上 */}
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
            <div ref={scrollerRef} className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain no-scrollbar">
              {books.map((b, i) => (
                <FlipSlide key={b.id} book={b} index={i} active={i === activeIdx} registerVideo={registerVideo} userPausedRef={userPausedRef} />
              ))}
            </div>
            {/* 顶部装饰短线 */}
            <div className="pointer-events-none absolute left-1/2 z-10 h-px w-16 -translate-x-1/2 bg-gradient-to-r from-transparent via-brass/70 to-transparent" style={{ top: "calc(env(safe-area-inset-top) + 10px)" }} />
            {/* 喇叭（页面级，集中控制当前条；图标反映实际静音态） */}
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

function FlipSlide({ book, index, active, registerVideo, userPausedRef }: { book: Book; index: number; active: boolean; registerVideo: (i: number, el: HTMLVideoElement | null) => void; userPausedRef: { current: boolean[] } }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false); // 仅在视频真正起播(onPlay/onPlaying)后才 true
  const [loaded, setLoaded] = useState(false); // 视频可播放（缓冲完成）
  const [burst, setBurst] = useState(0);
  const [err, setErr] = useState(false);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const myReviews = useLibrary((s) => s.myReviews);
  const toast = useUI((s) => s.toast);
  const setMediaPlayed = useLibrary((s) => s.setMediaPlayed);
  const pushHistory = useLibrary((s) => s.pushHistory);
  const lastT = useRef<number | null>(null);
  const playedSec = useRef(0);
  const lastReport = useRef(0);
  const realId = book.id.split("__")[0];
  const fav = favorites.includes(realId);
  useReadingClock(active && playing && !err); // 仅「当前可见且在播」的那一条计入「我的-总时长」（避免离屏条多倍计时）

  const setVideoRef = useCallback((el: HTMLVideoElement | null) => { videoRef.current = el; registerVideo(index, el); }, [index, registerVideo]);

  // 进度与「泡馆」共享 mediaPlayed(真实观看覆盖，用于已读判定)/history；乱翻为发现流，不写 mediaProgress(续播位置归泡馆所有，避免污染/快进)
  function writeMedia(force = false) {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const played = useLibrary.getState().mediaPlayed[realId] ?? 0;
    if (played <= 0) return; // 没真正播过就不记，避免划过即入历史
    const now = Date.now();
    if (!force && now - lastReport.current < 5000) return;
    lastReport.current = now;
    const prog = played >= 0.9 ? 100 : Math.round(played * 100);
    pushHistory({ bookId: realId, bookTitle: book.title, author: book.author, coverSeed: book.coverSeed, cover: book.cover, mode: "video", progress: prog, lastAt: new Date().toISOString() });
  }
  function onTime(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget;
    const cur = v.currentTime;
    const dur = v.duration || 0;
    if (dur <= 0) return;
    if (lastT.current !== null) {
      const d = cur - lastT.current;
      // 仅正常向前推进才累计真实观看覆盖（排除 loop 回绕、拖动等大跳变）
      if (d > 0 && d < 1.5) { playedSec.current += d; setMediaPlayed(realId, playedSec.current / dur); }
    }
    lastT.current = cur;
    writeMedia();
  }

  function triggerBurst() {
    setBurst((n) => n + 1);
    setTimeout(() => setBurst((n) => Math.max(0, n - 1)), 800);
  }
  function favOnly() {
    requireLogin(() => {
      // 双击=收藏（非切换）：读实时收藏态，避免登录边界用到渲染期捕获的过期 fav 闭包
      if (!useLibrary.getState().isFav(realId)) { toggleFav(realId); toast("已收藏"); }
      triggerBurst();
    });
  }
  // 单击切换播放/暂停：用户主动暂停意图写入页面级 userPausedRef[index]，playActive/kick 据此不强行重播
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { userPausedRef.current[index] = false; v.play().catch(() => {}); }
    else { userPausedRef.current[index] = true; v.pause(); }
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
  function openReview() {
    requireLogin(() => router.push(`/library/book/${realId}/review/new`));
  }

  return (
    <div className="relative h-full w-full snap-start snap-always overflow-hidden bg-dark-bg">
      {/* 前景视频：object-cover 铺满整块视频区、裁切到无黑边。muted 由页面集中命令式控制(不用 React prop) */}
      {!err ? (
        <video
          ref={setVideoRef}
          src={book.videoUrl}
          className="absolute inset-0 h-full w-full object-cover"
          loop
          playsInline
          onClick={onTap}
          onTimeUpdate={onTime}
          onCanPlay={() => setLoaded(true)}
          onPlay={() => setPlaying(true)}
          onPlaying={() => { setLoaded(true); setPlaying(true); }}
          onWaiting={() => setLoaded(false)}
          onPause={() => {
            setPlaying(false);
            lastT.current = null; // 暂停后重置增量基准，避免跨段误计
            writeMedia(true);
            // 非用户主动暂停、且仍是当前条 → 自动恢复（防快速上滑被 AbortError 误暂停）
            if (active && !userPausedRef.current[index]) videoRef.current?.play().catch(() => {});
          }}
          onLoadedMetadata={(e) => {
            // 乱翻为发现流，始终从头播；不做续播 seek（避免同书副本/循环导致快进到结尾）。仅以已存覆盖作为累计基线。
            const v = e.currentTarget;
            if (v.duration) playedSec.current = (useLibrary.getState().mediaPlayed[realId] ?? 0) * v.duration;
          }}
          onError={() => setErr(true)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-dark-text/70">
          <Motif name="cloud" className="relative w-24 text-celadon/20" />
          <p className="relative">这本书的视频暂时无法播放</p>
          <button onClick={() => router.push(`/library/book/${realId}`)} className="relative rounded-full border border-celadon/50 bg-white/8 px-5 py-2 text-sm text-celadon-300 backdrop-blur-md active:scale-95">看图文详情</button>
        </div>
      )}

      {/* 缓冲加载页：进入/缓冲时显示，缓解黑屏焦虑 */}
      {active && !err && !loaded && (
        <div className="pointer-events-none absolute inset-0 z-[6] flex flex-col items-center justify-center gap-3">
          <span className="h-11 w-11 animate-spin rounded-full border-2 border-white/15 border-t-celadon" />
          <span className="text-xs tracking-wide text-dark-text/55">视频加载中…</span>
        </div>
      )}

      {active && !playing && loaded && !err && (
        <button onClick={togglePlay} aria-label="播放" className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 animate-scale-in items-center justify-center rounded-full bg-black/35 ring-1 ring-celadon/40 backdrop-blur-md">
            <Play size={28} className="ml-1 text-dark-text" />
          </span>
        </button>
      )}

      {burst > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="absolute h-28 w-28 animate-like-burst rounded-full bg-rouge/25 blur-md" />
          <Heart size={120} className="animate-like-burst fill-rouge text-rouge drop-shadow-[0_4px_16px_rgba(168,66,58,0.5)]" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-dark-bg/85 via-dark-bg/15 to-transparent" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 80% at 50% 42%, transparent 55%, rgba(0,0,0,0.4))" }} />
      <Motif name="branch" className="pointer-events-none absolute bottom-28 -left-4 w-28 text-brass/10" />

      {/* 右侧操作栏：收藏 + 书评（均不显示数字） */}
      <div
        className="absolute right-3 z-10 flex flex-col items-center gap-6"
        style={{ bottom: "150px" }}
      >
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
        {/* 书名/标签/简介常显（不随播放/暂停隐藏）；去掉作者与左侧竖线，书名字号收小 */}
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

function Action({
  icon,
  label,
  onClick,
  ariaLabel,
  pressed,
}: {
  icon: React.ReactNode;
  label?: string;
  onClick: () => void;
  ariaLabel: string;
  pressed?: boolean;
}) {
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
