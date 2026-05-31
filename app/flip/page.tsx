"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bookmark, MessageSquare, ArrowRight, Play, Volume2, VolumeX } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Motif } from "@/components/ui/Motif";
import { MediaSpinner } from "@/components/ui/States";
import { getFlip } from "@/lib/api";
import { formatCount, realId } from "@/lib/utils";
import { useLibrary, useUI, requireLogin } from "@/lib/store";
import type { Book } from "@/lib/types";

export default function FlipPage() {
  const router = useRouter();
  const [muted, setMuted] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  // 首条声音引导：是否曾解锁过声音（localStorage 记忆，避免每次进页面都弹）
  const [hintDone, setHintDone] = useState(true); // 初值 true 防止 SSR 闪现
  useEffect(() => {
    setHintDone(localStorage.getItem("flip_sound_hint") === "1");
  }, []);

  // 乱翻竖滑流改用 useInfiniteQuery 统一管理（与分类页一致）：自带去重/竞态/缓存，
  // 返回该页不再丢已加载数据；getFlip 已是确定性洗牌，pageParam 用「已 seen 的 id 列表」。
  const q = useInfiniteQuery({
    queryKey: ["flip"],
    queryFn: ({ pageParam }) => getFlip(pageParam),
    initialPageParam: [] as string[],
    getNextPageParam: (_last, all) => all.flat().map((b) => b.id),
  });
  const books = q.data?.pages.flat() ?? [];
  const loading = q.isLoading;

  // 临近列表尾部时预取下一批（沿用 activeIdx 触底判断）
  useEffect(() => {
    if (!loading && books.length && activeIdx >= books.length - 2 && q.hasNextPage && !q.isFetchingNextPage) {
      q.fetchNextPage();
    }
  }, [activeIdx, books.length, loading]); // eslint-disable-line

  // 点过静音按钮即视为引导完成（持久化）
  function onMute() {
    setMuted((m) => !m);
    if (!hintDone) {
      localStorage.setItem("flip_sound_hint", "1");
      setHintDone(true);
    }
  }

  return (
    <main className="h-[100svh] overflow-hidden bg-dark-bg">
      {loading ? (
        <FlipSkeleton />
      ) : books.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
          <Motif name="cloud" className="w-28 text-celadon/20" />
          <p className="font-serif text-lg text-dark-text/90">乱翻里还没有视频解读</p>
          <p className="text-[13px] text-dark-text/55">先去泡馆翻翻，更多书正在路上</p>
          <button
            onClick={() => router.push("/library")}
            className="mt-1 rounded-full border border-celadon/50 bg-white/8 px-5 py-2 text-sm text-celadon-300 backdrop-blur-md active:scale-95"
          >
            去泡馆看看
          </button>
        </div>
      ) : (
        <div className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain no-scrollbar">
          {books.map((b, i) => (
            <FlipSlide
              key={b.id}
              book={b}
              muted={muted}
              onMute={onMute}
              onActive={() => setActiveIdx(i)}
              near={Math.abs(i - activeIdx) <= 1}
              // 仅首条、未解锁过声音、且当前静音时显示「轻点开启声音」引导
              showHint={!hintDone && muted && i === 0}
            />
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

function FlipSlide({
  book,
  muted,
  onMute,
  onActive,
  near,
  showHint,
}: {
  book: Book;
  muted: boolean;
  onMute: () => void;
  onActive: () => void;
  near: boolean;
  showHint: boolean;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  // 双击「收藏」迸发：每次触发 push 一个唯一 key 实例，动画结束自卸载（保证可连续重放）
  const [bursts, setBursts] = useState<number[]>([]);
  const [err, setErr] = useState(false);
  const lastTap = useRef(0);
  const prevPlaying = useRef(true); // 单击切换前的播放状态，供双击撤销用

  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const toast = useUI((s) => s.toast);
  // 乱翻非首轮的书带 __f 后缀，上报/续播/收藏一律按真实 id，避免污染历史去重与重复条目
  const id = realId(book.id);
  const fav = favorites.includes(id);

  // 历史上报（按真实 id，5s 节流，复用 Players 同口径）：让看过的解读能在「我的-历史」找回
  const pushHistory = useLibrary((s) => s.pushHistory);
  const setProgress = useLibrary((s) => s.setProgress);
  const lastReport = useRef(0);
  function report(curT: number, dur: number) {
    const now = Date.now();
    if (dur <= 0 || now - lastReport.current < 5000) return;
    lastReport.current = now;
    const pct = Math.max(1, Math.round((curT / dur) * 100));
    pushHistory({ bookId: id, bookTitle: book.title, author: book.author, coverSeed: book.coverSeed, cover: book.cover, mode: "video", progress: pct, lastAt: new Date().toISOString() });
    setProgress({ bookId: id, chapterId: `${id}-video`, chapterNo: 1, pct, mode: "video" });
  }

  useEffect(() => {
    const el = ref.current;
    const v = videoRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e.isIntersecting) {
          onActive();
          // 播放被随即 pause() 打断会抛 AbortError，忽略它避免误置暂停
          v?.play().then(() => setPlaying(true)).catch((err) => {
            if (err?.name !== "AbortError") setPlaying(false);
          });
        } else if (v) {
          v.pause();
          // 不再 v.currentTime = 0：loop 视频保留断点，划回不强制从头重播
        }
      },
      { threshold: 0.6 }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []); // eslint-disable-line

  // 卸载清理：竖滑流频繁挂卸，避免回调在已卸载组件上空跑（F57）
  // 当前实现仅用 ref 记录时间戳、无悬挂 setTimeout，保留空清理以防未来回归。
  useEffect(() => () => { lastTap.current = 0; }, []);

  function triggerBurst() {
    // 每次 push 一个唯一 key，独立挂载即可重放；onAnimationEnd 自卸载
    setBursts((b) => [...b, Date.now() + Math.random()]);
  }
  function favOnly() {
    requireLogin(() => {
      if (!fav) { toggleFav(id); toast("已收藏"); }
      triggerBurst();
    });
  }
  function setPlay(v: HTMLVideoElement, on: boolean) {
    if (on) { v.play().catch(() => {}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }
  function onTap() {
    const v = videoRef.current;
    if (!v) return;
    const now = Date.now();
    if (now - lastTap.current < 280) {
      // 双击：撤销刚才那次单击的 toggle，恢复到第一击之前的状态，改为收藏（无中间帧闪烁）
      lastTap.current = 0;
      setPlay(v, prevPlaying.current);
      favOnly();
    } else {
      // 单击：零延迟立即切换播放/暂停（先记下切换前状态，供双击撤销）
      lastTap.current = now;
      prevPlaying.current = !v.paused;
      setPlay(v, v.paused);
    }
  }

  return (
    <div ref={ref} className="relative h-[100svh] w-full snap-start snap-always overflow-hidden bg-dark-bg">
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
            // 仅当前/相邻屏预取，离屏一律 none，避免首屏并发 N 个请求与流量飙升
            preload={near ? "auto" : "none"}
            onClick={onTap}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => { setBuffering(false); setPlaying(true); }}
            onCanPlay={() => { setReady(true); setBuffering(false); }}
            onTimeUpdate={(e) => report(e.currentTarget.currentTime, e.currentTarget.duration || 0)}
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
          <button onClick={() => router.push(`/library/book/${id}`)} className="relative rounded-full border border-celadon/50 bg-white/8 px-5 py-2 text-sm text-celadon-300 backdrop-blur-md active:scale-95">看图文详情</button>
        </div>
      )}

      {/* 缓冲指示（青瓷转圈）：与大播放钮互斥，避免叠加 */}
      {ready && buffering && !err && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <MediaSpinner className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]" />
        </div>
      )}

      {/* 暂停指示：纯视觉层、不拦截点击，play/pause 统一由 video 的 onTap 处理 */}
      {!playing && !buffering && !err && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 animate-scale-in items-center justify-center rounded-full bg-black/35 ring-1 ring-celadon/40 backdrop-blur-md">
            <Play size={28} className="ml-1 text-dark-text" />
          </span>
        </div>
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

      {/* 首条声音引导：未解锁过声音且静音时，喇叭下方轻提示一行（划走或点过即不再显示） */}
      {showHint && (
        <div
          className="pointer-events-none absolute right-3 z-20 animate-fade-up rounded-full bg-black/40 px-2.5 py-1 text-[11px] text-dark-text/90 ring-1 ring-brass/30 backdrop-blur-md"
          style={{ top: "calc(env(safe-area-inset-top) + 50px)" }}
        >
          轻点开启声音
        </div>
      )}

      {/* 双击收藏 · 墨痕迸发（每个唯一实例独立挂载，可连续重放） */}
      {bursts.map((bid) => (
        <div
          key={bid}
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          onAnimationEnd={() => setBursts((b) => b.filter((x) => x !== bid))}
        >
          <span className="absolute h-28 w-28 animate-like-burst rounded-full bg-celadon/30 blur-md" />
          <Bookmark size={120} className="animate-like-burst fill-celadon text-celadon drop-shadow-[0_4px_16px_rgba(127,166,148,0.5)]" />
        </div>
      ))}

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
          icon={<Bookmark size={30} className={fav ? "fill-celadon text-celadon" : "text-dark-text"} />}
          label={formatCount(book.favCount + (fav ? 1 : 0))}
          ariaLabel={fav ? "已收藏" : "收藏"}
          pressed={fav}
          onClick={() => requireLogin(() => { const n = toggleFav(id); toast(n ? "已收藏" : "已取消收藏"); if (n) triggerBurst(); })}
        />
        <Action
          icon={<MessageSquare size={28} className="text-dark-text" />}
          label={formatCount(book.reviewCount)}
          ariaLabel="查看书评"
          onClick={() => router.push(`/library/book/${id}/reviews`)}
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
          onClick={() => router.push(`/library/book/${id}`)}
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
