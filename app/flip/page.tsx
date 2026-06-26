"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Heart, MessageSquare, ArrowRight, Play, Volume2, VolumeX } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Motif } from "@/components/ui/Motif";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { getFlip } from "@/lib/api";
import { useAuth, useLibrary, useUI, requireLogin } from "@/lib/store";
import { useReadCountBump, useReadingClock } from "@/lib/useReadingClock";
import { formatTime } from "@/lib/utils";
import type { Book } from "@/lib/types";

// 模块级缓存：离开乱翻（如去写书评）再返回时，保持同一视频流与所在位置。
// 按账号隔离：换账号/退出后缓存作废（T3 接 flip_feed 个性化书单后尤其重要）
let flipCache: { books: Book[]; idx: number; uid: string } | null = null;
const cacheUid = () => useAuth.getState().user?.id ?? "guest";
let mutedHintShown = false; // 静音兜底提示：module 级标记，每次会话仅提示一次
// 乱翻自有的视频续播位置（按 realId 存分数）：与详情页 media_progress.position 解耦，避免乱翻自动播放
// 改写/污染详情页续播点、音视频共用一个分数导致落点错位、loop 回卷把位置清回 0（Bug#8）
const flipPos = new Map<string, number>();
function validCache() {
  if (flipCache && flipCache.uid !== cacheUid()) flipCache = null;
  return flipCache;
}

const SLOTS = 3; // 视频池大小：当前条 ±1，复用 3 个 <video> 元素，永不新建/卸载 → 永远只 3 个解码器
const slotOf = (i: number) => ((i % SLOTS) + SLOTS) % SLOTS;
// 槽位 s 当前承载哪本书的下标（取 [a-1,a,a+1] 中 slotOf===s 的那条）
function slotIdx(s: number, a: number, n: number) {
  for (const i of [a - 1, a, a + 1]) if (i >= 0 && i < n && slotOf(i) === s) return i;
  return -1;
}

export default function FlipPage() {
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>(() => validCache()?.books ?? []);
  const [loading, setLoading] = useState(() => !validCache());
  const [error, setError] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [mutedNow, setMutedNow] = useState(false);
  const [activeIdx, setActiveIdx] = useState(() => validCache()?.idx ?? 0);
  const [loaded, setLoaded] = useState(false); // 当前视频可播
  const [playing, setPlaying] = useState(false); // 当前视频在播
  const [userPaused, setUserPausedState] = useState(false); // 用户主动暂停（只此态显示播放按钮）
  const [vErr, setVErr] = useState(false);
  const [mutedHint, setMutedHint] = useState(false); // 静音兜底提示 chip（4 秒自隐）

  const fetching = useRef(false);
  const booksRef = useRef<Book[]>(books);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]); // 3 个复用视频元素
  const activeIdxRef = useRef(activeIdx);
  const soundOnRef = useRef(soundOn);
  const mutedNowRef = useRef(mutedNow);
  const userPausedRef = useRef(false);
  const lastT = useRef<number | null>(null);
  const playedSec = useRef(0);
  const lastReport = useRef(0);

  const setMediaPlayed = useLibrary((s) => s.setMediaPlayed);
  const pushHistory = useLibrary((s) => s.pushHistory);

  useEffect(() => { booksRef.current = books; }, [books]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { mutedNowRef.current = mutedNow; }, [mutedNow]);
  useReadingClock(playing && !vErr);
  useReadCountBump(books[activeIdx]?.id.split("__")[0], playing && !vErr); // 「一次阅读」计数（真实播放满30秒记一次）

  const setUserPaused = useCallback((v: boolean) => { userPausedRef.current = v; setUserPausedState(v); }, []);
  const activeVideo = useCallback(() => videoRefs.current[slotOf(activeIdxRef.current)] ?? null, []);

  // 进度条拖动定位后：重置真实播放基准（防把跳变计入），并立即落一次续播位置（暂停态拖动也同步）
  const onSeeked = useCallback(() => {
    lastT.current = null;
    const v = videoRefs.current[slotOf(activeIdxRef.current)];
    const b = booksRef.current[activeIdxRef.current];
    if (v && v.duration && b) flipPos.set(b.id.split("__")[0], v.currentTime / v.duration); // 写乱翻自有位置，不污染详情页（Bug#8）
  }, []);

  // 写阅读历史（不依赖视频元素：卸载时 ref 已被 React 置空也要能落账）；played>0 已保证"真实播过才记"
  const writeMedia = useCallback((force = false) => {
    const b = booksRef.current[activeIdxRef.current];
    if (!b) return;
    const rid = b.id.split("__")[0];
    const played = useLibrary.getState().mediaPlayed[rid] ?? 0;
    if (played <= 0) return;
    const now = Date.now();
    if (!force && now - lastReport.current < 5000) return;
    lastReport.current = now;
    const prog = played >= 0.9 ? 100 : Math.round(played * 100);
    pushHistory({ bookId: rid, bookTitle: b.title, author: b.author, coverSeed: b.coverSeed, cover: b.cover, mode: "video", progress: prog, lastAt: new Date().toISOString() });
  }, [pushHistory]);

  // 还原当前书的「真实播放基线 + 续播位置」。仅在 metadata 就绪时生效；
  // 在「切条 effect」与「onLoadedMetadata」两处调用，覆盖两种时序：
  //   ① 相邻槽位预加载完→滑过去（metadata 早就绪，不会再触发 loadedmetadata）
  //   ② 快滑两屏新分配 src（active 在先，metadata 后到）
  // 否则会拿上一本书的 playedSec 给新书累计——mediaPlayed 只增不可逆，会永久虚高、误判已读。
  const primeActive = useCallback(() => {
    const v = activeVideo();
    const b = booksRef.current[activeIdxRef.current];
    if (!v || !b || !v.duration) return;
    const rid = b.id.split("__")[0];
    const st = useLibrary.getState();
    playedSec.current = (st.mediaPlayed[rid] ?? 0) * v.duration;
    lastT.current = null; // seek 跳变不计入真实播放
    // 续播位置用乱翻自有记录（与详情页解耦）：避免详情页音频位置被错当成视频位置、或被乱翻反向污染（Bug#8）
    const p = flipPos.get(rid) ?? 0;
    if (p > 0 && p < 0.99) { try { v.currentTime = p * v.duration; } catch {} }
  }, []);

  // 播当前槽位视频、暂停其余；带声被拦则静音兜底（绝不暂停）
  const playActive = useCallback(() => {
    const aSlot = slotOf(activeIdxRef.current);
    videoRefs.current.forEach((v, s) => { if (v && s !== aSlot && !v.paused) v.pause(); });
    const v = videoRefs.current[aSlot];
    if (!v || userPausedRef.current) return;
    v.muted = !soundOnRef.current;
    setMutedNow(v.muted);
    // 异步回调守卫：play() Promise 落定时用户可能已快滑切条（pause 旧槽会让 pending play 以
    // AbortError 拒绝）。不带守卫会复活旧槽后台播放、污染全局静音图标、误烧静音提示、
    // 把旧槽的源错误盖到新条上——四个症状一锅端。
    const stillActive = () => slotOf(activeIdxRef.current) === aSlot;
    v.play().then(() => { if (stillActive()) setMutedNow(v.muted); }).catch(() => {
      if (!stillActive()) return;
      v.muted = true;
      setMutedNow(true);
      // 静音兜底首次触发：提示「轻点开启声音」，4 秒自隐（每次会话仅一次）
      if (!mutedHintShown) {
        mutedHintShown = true;
        setMutedHint(true);
        setTimeout(() => setMutedHint(false), 4000);
      }
      v.play().catch(() => { if (stillActive() && v.error) setVErr(true); }); // 静音兜底也播不动且源已坏 → 走错误兜底而非一直转圈
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    getFlip([])
      // 缓存主人戳用 getFlip 返回的 owner（与书池查询同源）：用页面侧 zustand uid 会在冷启动时
      // 把登录用户的个性化池错标成 guest，退出登录后游客续看上一账号书单
      .then(({ books: b, owner }) => { setBooks(b); setLoading(false); flipCache = { books: b, idx: 0, uid: owner }; })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  useEffect(() => {
    const cache = validCache();
    if (cache && cache.books.length) {
      const idx = cache.idx;
      requestAnimationFrame(() => { const el = scrollerRef.current; if (el) el.scrollTop = idx * el.clientHeight; });
      return;
    }
    load();
  }, [load]);

  const loadMore = useCallback(() => {
    if (fetching.current) return;
    fetching.current = true;
    getFlip(booksRef.current.map((b) => b.id))
      .then(({ books: more }) => setBooks((cur) => { const next = [...cur, ...more]; if (flipCache) flipCache.books = next; return next; }))
      .catch(() => {}) // 弱网续拉失败静默：fetching 复位后下次滑动自动重试（不 catch 会冒未处理 rejection）
      .finally(() => { fetching.current = false; });
  }, []);

  useEffect(() => {
    if (!loading && books.length && activeIdx >= books.length - 2) loadMore();
  }, [activeIdx, books.length, loading, loadMore]);

  // 切到新条：落上一条进度 → 清零计数基准（防旧书秒数污染新书，mediaPlayed 只增不可逆）→ 还原新书基线/续播 → 播
  const slotInited = useRef(false);
  useEffect(() => {
    // 续拉 append 只变 books.length、activeIdx 未变：不得重跑切条逻辑——原实现会在请求返回瞬间
    // 强制取消用户主动暂停并自动续播、闪断错误兜底层、重复 seek 与落账（Review P1）
    if (slotInited.current && activeIdxRef.current === activeIdx) return;
    writeMedia(true); // 此时 activeIdxRef 仍是旧条 → 收尾旧条
    activeIdxRef.current = activeIdx;
    if (flipCache) flipCache.idx = activeIdx;
    if (loading || !books.length) return;
    slotInited.current = true;
    playedSec.current = 0;
    lastT.current = null;
    setUserPaused(false);
    setVErr(false);
    const v = activeVideo();
    setLoaded(v ? v.readyState >= 3 : false);
    setPlaying(v ? !v.paused : false);
    primeActive(); // metadata 已就绪（预加载槽位）则立即还原；未就绪则等 onLoadedMetadata 再还原
    playActive();
    // eslint-disable-next-line
  }, [activeIdx, books.length, loading, writeMedia, setUserPaused, primeActive, playActive]);

  // 卸载（去详情页/写书评/切 Tab）：把最后一段观看落进历史（不依赖视频元素，ref 置空也能写）
  useEffect(() => () => writeMedia(true), [writeMedia]);

  // 切后台：落账；回前台：续播（不打破用户主动暂停）
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") { if (!userPausedRef.current) playActive(); }
      else writeMedia(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [playActive, writeMedia]);

  const onActive = useCallback((i: number) => { setActiveIdx(i); }, []);

  // 当前条由滚动落点决定
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

  // 手势内触发播放（微信只认手势内 play → 带声解锁）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const kick = () => playActive();
    el.addEventListener("pointerdown", kick, { passive: true });
    el.addEventListener("touchstart", kick, { passive: true });
    return () => { el.removeEventListener("pointerdown", kick); el.removeEventListener("touchstart", kick); };
  }, [playActive, books.length, loading]);

  // 微信 X5 默认禁自动播放，等 JS 桥就绪触发
  useEffect(() => {
    if (loading || !books.length) return;
    const kick = () => playActive();
    if (typeof window !== "undefined" && "WeixinJSBridge" in window) kick();
    else document.addEventListener("WeixinJSBridgeReady", kick, { once: true });
    return () => document.removeEventListener("WeixinJSBridgeReady", kick);
  }, [loading, books.length, playActive]);

  // 静音钮只管声音，不打破「用户主动暂停」：开声时仅当视频本应在播却没播才补 play
  const toggleSound = useCallback(() => {
    setMutedHint(false); // 点声音钮：兜底提示立即消失
    const turnOn = mutedNowRef.current;
    setSoundOn(turnOn);
    const v = activeVideo();
    if (v) { v.muted = !turnOn; setMutedNow(!turnOn); if (turnOn && !userPausedRef.current && v.paused) v.play().catch(() => {}); }
  }, []);

  const togglePlay = useCallback(() => {
    const v = activeVideo();
    if (!v) return;
    if (v.paused) { setUserPaused(false); v.play().catch(() => {}); }
    else { setUserPaused(true); v.pause(); }
  }, [setUserPaused]);

  // 当前槽位视频事件（仅 active 槽位生效）
  const isActive = (s: number) => slotOf(activeIdxRef.current) === s;
  const onSlotTime = (s: number, e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!isActive(s)) return;
    const v = e.currentTarget;
    const b = booksRef.current[activeIdxRef.current];
    if (!b) return;
    const cur = v.currentTime; const dur = v.duration || 0;
    if (dur <= 0) return;
    const rid = b.id.split("__")[0];
    if (lastT.current !== null) { const d = cur - lastT.current; if (d > 0 && d < 1.5) { playedSec.current += d; setMediaPlayed(rid, playedSec.current / dur); } }
    lastT.current = cur;
    flipPos.set(rid, cur / dur); // 续播位置记到乱翻自有 map（与详情页解耦，loop 回卷不再污染详情续播点·Bug#8）
    writeMedia();
  };
  const onSlotMeta = (s: number) => {
    if (!isActive(s)) return;
    primeActive(); // 时序②：active 在先、metadata 后到 → 此刻还原基线/续播
  };

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-dark-bg">
      <div className="absolute inset-x-0 top-0" style={{ bottom: "calc(3.75rem + env(safe-area-inset-bottom))" }}>
        {loading ? (
          <FlipSkeleton />
        ) : error ? (
          <div className="flex h-full items-center justify-center text-dark-text">
            <ErrorState onDark title="内容加载失败" subtitle="请检查网络后重试" onRetry={load} />
          </div>
        ) : books.length === 0 ? (
          <div className="flex h-full items-center justify-center text-dark-text">
            <EmptyState onDark icon="book" title="暂无视频解读" subtitle="去泡馆挑一本书读读吧" actionText="去泡馆逛逛" actionHref="/library" />
          </div>
        ) : (
          <>
            <div ref={scrollerRef} className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain no-scrollbar">
             {/* 滚动内容包裹层：高 = 书数×单屏；视频与卡片都在其内，随内容一起滚（绝对定位相对此层、不被钉在视口） */}
             <div className="relative w-full" style={{ height: `${books.length * 100}%` }}>
              {/* 封面垫底（视频未出帧时可见）：大图重度 blur 压暗只做氛围，前景居中一张适中锐利封面——
                  音乐播放器式构图，避免封面糊满全屏的压迫感；与视频同 z 且 DOM 在前 → 视频出帧自然盖住 */}
              {books.map((b, i) =>
                b.cover && Math.abs(i - activeIdx) <= 1 ? (
                  <div
                    key={`backdrop-${b.id}`}
                    className="absolute inset-x-0 z-0 overflow-hidden"
                    style={{ top: `${(i / books.length) * 100}%`, height: `${100 / books.length}%` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.cover} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-[0.35]" />
                    <div className="absolute inset-0 flex items-center justify-center pb-24">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.cover} alt="" className="w-44 rounded-xl object-cover shadow-2xl ring-1 ring-white/15" />
                    </div>
                  </div>
                ) : null
              )}
              {/* 视频池：3 个复用元素，定位在各自卡片偏移、随内容一起滚（跟手），仅占 3 个解码器 */}
              {Array.from({ length: SLOTS }, (_, s) => {
                const i = slotIdx(s, activeIdx, books.length);
                const b = i >= 0 ? books[i] : undefined;
                return (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    key={`slot-${s}`}
                    ref={(el) => { videoRefs.current[s] = el; }}
                    src={b?.videoUrl}
                    // 当前槽全量预载（接续零等待），相邻槽只拉 metadata（流量可控）：滑到下一条不再必见缓冲圈
                    preload={isActive(s) ? "auto" : "metadata"}
                    className="absolute inset-x-0 z-0 w-full object-cover"
                    style={{ top: i >= 0 ? `${(i / books.length) * 100}%` : "-200%", height: `${100 / books.length}%` }}
                    loop
                    playsInline
                    onTimeUpdate={(e) => onSlotTime(s, e)}
                    onCanPlay={() => { if (isActive(s)) setLoaded(true); }}
                    onPlay={() => { if (isActive(s)) setPlaying(true); }}
                    onPlaying={() => { if (isActive(s)) { setLoaded(true); setPlaying(true); } }}
                    onWaiting={() => { if (isActive(s)) setLoaded(false); }}
                    onPause={() => { if (isActive(s)) { setPlaying(false); lastT.current = null; writeMedia(true); if (!userPausedRef.current && document.visibilityState === "visible") videoRefs.current[s]?.play().catch(() => {}); } }}
                    onLoadedMetadata={() => onSlotMeta(s)}
                    onError={() => { if (isActive(s) && videoRefs.current[s]?.getAttribute("src")) setVErr(true); }}
                  />
                );
              })}

              {/* 每条占位 div：撑起滚动高度 + snap；仅当前条 ±2 渲染 overlay 内容（虚拟化，支持 100+ 本） */}
              {books.map((b, i) => (
                <div key={b.id} className="relative z-10 w-full snap-start snap-always" style={{ height: `${100 / books.length}%` }}>
                  {Math.abs(i - activeIdx) <= 2 && <FlipOverlay book={b} active={i === activeIdx} onTogglePlay={togglePlay} />}
                </div>
              ))}
             </div>
            </div>

            {/* 当前视频加载失败兜底 */}
            {vErr && (
              <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center text-dark-text/70">
                <Motif name="cloud" className="relative w-24 text-celadon/20" />
                <p className="relative">这本书的视频暂时无法播放</p>
                <div className="relative flex items-center gap-3">
                  {/* 重试：重置错误态 → 重新拉流 → 续播（幽灵样式，与详情入口并排） */}
                  <button onClick={() => { setVErr(false); setLoaded(false); activeVideo()?.load(); playActive(); }} className="pointer-events-auto rounded-full border border-white/25 bg-white/8 px-5 py-2 text-sm text-dark-text/80 backdrop-blur-md active:scale-95">重试</button>
                  <button onClick={() => { const b = books[activeIdx]; if (b) router.push(`/library/book/${b.id.split("__")[0]}`); }} className="pointer-events-auto rounded-full border border-celadon/50 bg-white/8 px-5 py-2 text-sm text-celadon-300 backdrop-blur-md active:scale-95">看图文详情</button>
                </div>
              </div>
            )}

            {/* 缓冲加载页 */}
            {!vErr && !loaded && (
              <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3">
                <span className="h-11 w-11 animate-spin rounded-full border-2 border-white/15 border-t-celadon" />
                <span className="text-xs tracking-wide text-dark-text/55">视频加载中</span>
              </div>
            )}

            {/* 播放按钮：仅用户主动暂停时显示（杜绝"暂停显示但在放"） */}
            {!vErr && userPaused && loaded && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <button onClick={togglePlay} aria-label="播放" className="pointer-events-auto flex h-16 w-16 animate-scale-in items-center justify-center rounded-full bg-black/35 ring-1 ring-celadon/40 backdrop-blur-md">
                  <Play size={28} className="ml-1 text-dark-text" />
                </button>
              </div>
            )}

            {/* 底部播放进度条（抖音式：细线 + 可拖动定位，拖动时显时间） */}
            {!vErr && <FlipProgress getVideo={activeVideo} onSeeked={onSeeked} />}

            <div className="pointer-events-none absolute left-1/2 z-20 h-px w-16 -translate-x-1/2 bg-gradient-to-r from-transparent via-brass/70 to-transparent" style={{ top: "calc(env(safe-area-inset-top) + 10px)" }} />
            <button
              onClick={toggleSound}
              aria-label={mutedNow ? "开启声音" : "静音"}
              className="absolute right-3 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-dark-text/90 ring-1 ring-brass/30 backdrop-blur-md transition active:scale-90"
              style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
            >
              {mutedNow ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            {/* 静音兜底提示：声音钮下方小 chip，4 秒自隐，点声音钮立即消失 */}
            {mutedHint && (
              <div className="pointer-events-none absolute right-3 z-30 animate-fade-up rounded-full bg-black/45 px-3 py-1.5 text-[11px] text-dark-text ring-1 ring-brass/30 backdrop-blur-md" style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}>
                轻点开启声音
              </div>
            )}
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

// 每条叠加层（文字/收藏/书评/渐变/点击层），透明铺在视频上；视频由池统一承载
function FlipOverlay({ book, active, onTogglePlay }: { book: Book; active: boolean; onTogglePlay: () => void }) {
  const router = useRouter();
  const [burst, setBurst] = useState(0);
  const [bounce, setBounce] = useState(0); // 收藏瞬间右侧心形按钮弹跳触发器
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 单击延时回调里读最新 active：280ms 内快滑切条后，迟到的单击不再误暂停新条（A2 竞态）
  const activeRef = useRef(active);
  activeRef.current = active;
  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const myReviews = useLibrary((s) => s.myReviews);
  const toast = useUI((s) => s.toast);
  const realId = book.id.split("__")[0];
  const fav = favorites.includes(realId);

  // 卸载（滑出 ±2 渲染窗）时清掉在途单击延时器，防迟到回调落在已卸载组件
  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current); }, []);

  // 小心心散开参数：每次爆发重算（随机方向/大小，逐颗延迟 50ms）
  const minis = useMemo(
    () =>
      Array.from({ length: 4 }, (_, k) => ({
        size: 12 + Math.round(Math.random() * 8),
        tx: (Math.random() - 0.5) * 150,
        ty: -20 - Math.random() * 80,
        delay: k * 50,
      })),
    [burst]
  );

  function triggerBurst() { setBurst((n) => n + 1); setTimeout(() => setBurst((n) => Math.max(0, n - 1)), 800); }
  // 双击收藏：爆发动画即是反馈，不再叠 toast（右侧按钮路径保留 toast）
  function favOnly() { requireLogin(() => { if (!useLibrary.getState().isFav(realId)) { toggleFav(realId); setBounce((n) => n + 1); } triggerBurst(); }); }
  function onTap() {
    const now = Date.now();
    if (now - lastTap.current < 280) { if (tapTimer.current) clearTimeout(tapTimer.current); lastTap.current = 0; favOnly(); }
    else { lastTap.current = now; tapTimer.current = setTimeout(() => { if (activeRef.current) onTogglePlay(); lastTap.current = 0; }, 280); }
  }
  function openReview() { requireLogin(() => router.push(`/library/book/${realId}/review/new`)); }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <button className="absolute inset-0 z-0" onClick={onTap} aria-label="播放 / 暂停" />

      {burst > 0 && (
        // key=burst：快速连续双击时强制重挂载，动画必定从头重播（A10）
        <div key={burst} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="absolute h-28 w-28 animate-like-burst rounded-full bg-rouge/25 blur-md" />
          <Heart size={120} className="animate-like-burst fill-rouge text-rouge drop-shadow-[0_4px_16px_rgba(168,66,58,0.5)]" />
          {minis.map((m, k) => (
            <Heart
              key={k}
              size={m.size}
              style={{ "--tx": `${m.tx}px`, "--ty": `${m.ty}px`, animationDelay: `${m.delay}ms` } as React.CSSProperties}
              className="absolute animate-like-fly fill-rouge text-rouge"
            />
          ))}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[32%] bg-gradient-to-t from-dark-bg/80 via-dark-bg/15 to-transparent" />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 80% at 50% 42%, transparent 55%, rgba(0,0,0,0.4))" }} />
      <Motif name="branch" className="pointer-events-none absolute bottom-28 -left-4 w-28 text-brass/10" />

      <div className="absolute right-3 z-10 flex flex-col items-center gap-6" style={{ bottom: "150px" }}>
        <Action
          icon={
            // key=bounce：每次收藏重挂载重播 [1,1.35,1] 弹跳
            <motion.span key={bounce} animate={bounce > 0 ? { scale: [1, 1.35, 1] } : undefined} transition={{ duration: 0.4, ease: "easeOut" }} className="flex">
              <Heart size={30} className={fav ? "fill-rouge text-rouge" : "text-dark-text"} />
            </motion.span>
          }
          ariaLabel={fav ? "已收藏" : "收藏"}
          pressed={fav}
          onClick={() => requireLogin(() => { const n = toggleFav(realId); toast(n ? "已收藏" : "已取消收藏"); if (n) { triggerBurst(); setBounce((x) => x + 1); } })}
        />
        <Action icon={<MessageSquare size={28} className="text-dark-text" />} ariaLabel={myReviews.some((r) => r.bookId === realId) ? "编辑书评" : "写书评"} onClick={openReview} />
      </div>

      {/* 底部信息：整体缩小、收紧行距，少挡视频内嵌字幕 */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 px-4" style={{ paddingBottom: "24px" }}>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-[15px] leading-snug tracking-wide text-dark-text drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]">{book.title}</h2>
          <div className="mt-1 flex flex-wrap gap-1">
            {book.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-full border border-brass/30 bg-black/35 px-2 py-0.5 text-[10px] font-medium text-dark-text/90 backdrop-blur-md">{t}</span>
            ))}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-[16px] text-dark-text/80">{book.intro}</p>
        </div>
        <button onClick={() => router.push(`/library/book/${realId}`)} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-celadon/80 px-3 py-1.5 text-[12px] font-medium text-white ring-1 ring-white/25 backdrop-blur-md transition active:scale-95">
          读这本书 <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

// 底部播放进度条：常态 2.5px 细线随播放推进（rAF 直写 DOM，不触发 React 重渲染）；
// 按下变粗可拖动定位，拖动中显示「当前 / 总时长」气泡；松手 seek 目标视频（按下时锁定，滑屏不串台）
function FlipProgress({ getVideo, onSeeked }: { getVideo: () => HTMLVideoElement | null; onSeeked: () => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ pct: number; cur: number; dur: number } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const targetRef = useRef<HTMLVideoElement | null>(null); // 按下瞬间锁定的视频（防拖动中滑到别条）
  useEffect(() => { dragRef.current = drag; }, [drag]);

  // 跟随播放：rAF 只改 DOM 宽度，零 React 开销；拖动中不跟随
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (dragRef.current || !fillRef.current) return;
      const v = getVideo();
      const pct = v && v.duration ? Math.min(1, v.currentTime / v.duration) : 0;
      fillRef.current.style.width = `${pct * 100}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getVideo]);

  const pctAt = (clientX: number) => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / (r.width || 1)));
  };
  const apply = (p: number, v: HTMLVideoElement) => {
    if (fillRef.current) fillRef.current.style.width = `${p * 100}%`;
    setDrag({ pct: p, cur: p * (v.duration || 0), dur: v.duration || 0 });
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = getVideo();
    if (!v || !v.duration) return;
    targetRef.current = v;
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(pctAt(e.clientX), v);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = targetRef.current;
    if (!dragRef.current || !v) return;
    apply(pctAt(e.clientX), v);
  };
  const finish = (commit: boolean) => {
    const d = dragRef.current;
    const v = targetRef.current;
    if (commit && d && v && v.duration) {
      try { v.currentTime = d.pct * v.duration; } catch {}
      onSeeked();
    }
    setDrag(null);
    targetRef.current = null;
  };

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30"
      style={{ height: 20, touchAction: "none" }} // 20px 命中区：好按，又不压到上方「读这本书」按钮（其底距 24px）
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
    >
      {drag && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3.5 py-1.5 text-[13px] tabular-nums text-white backdrop-blur-md">
          {formatTime(drag.cur)} <span className="text-white/50">/ {formatTime(drag.dur)}</span>
        </div>
      )}
      <div ref={barRef} className="absolute inset-x-3 bottom-[5px]">
        <div className={"relative w-full overflow-hidden rounded-full transition-[height] duration-150 " + (drag ? "h-[5px] bg-white/25" : "h-[2.5px] bg-white/15")}>
          <div ref={fillRef} className="h-full rounded-full bg-celadon" style={{ width: "0%" }} />
        </div>
        {drag && (
          <span
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-snow shadow ring-2 ring-celadon/60"
            style={{ left: `${drag.pct * 100}%` }}
          />
        )}
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
