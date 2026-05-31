"use client";
import { useState, useRef, useLayoutEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronLeft, Heart, ChevronRight, ChevronDown, PenLine, Check, BookOpen, Video, Headphones } from "lucide-react";
import { getBook, getChapters, getBookReviews } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { BookMediaHero } from "@/components/library/Players";
import { Skeleton, ErrorState, EmptyState } from "@/components/ui/States";
import { formatCount, formatDate, realId } from "@/lib/utils";
import { useLibrary, useUI, requireLogin } from "@/lib/store";
import type { Book } from "@/lib/types";

/** 返回栏：加载/错误/不存在/成功四态均常驻，保证任何时刻可返回（含刘海安全区避让） */
function BackBar() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      aria-label="返回"
      className="absolute left-2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-snow/80 text-ink backdrop-blur transition active:scale-90 dark:bg-dark-card/70 dark:text-dark-text"
      style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
    >
      <ChevronLeft size={24} />
    </button>
  );
}

export default function BookDetail({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const toast = useUI((s) => s.toast);
  // 订阅 favorites 数组：任何来源（乱翻页等）改收藏后返回本页都会自动同步
  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });
  const rvQ = useQuery({ queryKey: ["reviews", id, "hot"], queryFn: () => getBookReviews(id, "hot") });

  const book = bookQ.data;
  // 派生收藏态（与 store 的 real 规则一致，去 __ 后缀）；登出 reset 已清空 favorites，无需 user 门控
  const fav = !!book && favorites.includes(realId(book.id));
  const [justFaved, setJustFaved] = useState(false);
  const [expand, setExpand] = useState(false);

  // 简介真实溢出检测：与 line-clamp-3 同口径，替代 length>50 魔法数（hooks 必须在条件 return 之前声明）
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = summaryRef.current;
    if (!el) return;
    const check = () => {
      // 仅未展开（line-clamp-3 生效）时比较是否溢出
      if (!expand) setClamped(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [book?.summary, expand]);

  if (bookQ.isLoading) return <DetailSkeleton />;
  if (bookQ.isError)
    return (
      <main className="relative min-h-[100dvh]">
        <BackBar />
        <ErrorState onRetry={() => bookQ.refetch()} />
      </main>
    );
  if (!book)
    return (
      <main className="relative min-h-[100dvh]">
        <BackBar />
        <EmptyState
          icon="book"
          title="这本书不存在或已下架"
          subtitle="去泡馆看看别的好书"
          actionText="返回泡馆"
          actionHref="/library"
        />
      </main>
    );

  function onFav() {
    requireLogin(() => {
      const now = toggleFav(book!.id);
      if (now) {
        setJustFaved(true);
        setTimeout(() => setJustFaved(false), 350);
      }
      toast(now ? "已收藏" : "已取消收藏");
    });
  }

  return (
    <motion.main
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
      className="min-h-[100dvh] pb-12"
    >
      {/* 媒体台：封面即视频入口（竖屏全屏 · 可切音频）· 影院沉浸 */}
      <div id="media" className="relative overflow-hidden scroll-mt-2">
        <HeroBg book={book} />
        {/* 柔光 */}
        <div className="pointer-events-none absolute left-1/2 top-[24%] h-72 w-72 -translate-x-1/2 rounded-full bg-celadon/18 blur-[80px]" />
        <BackBar />
        <BookMediaHero book={book} />
      </div>

      {/* 题名 + 元信息（左对齐）· 右侧收藏药丸 */}
      <div className="px-4 pt-4">
        <h1 className="font-serif text-[26px] leading-tight tracking-[0.01em] text-ink dark:text-dark-text">{book.title}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-dark-text/55">{book.author}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {book.tags.map((t, i) => (
            <span key={t} className="animate-fade-up rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-500 dark:border-white/10 dark:text-dark-text/60" style={{ animationDelay: `${i * 0.04}s` }}>{t}</span>
          ))}
        </div>

        {/* 三模态对等入口：视频/音频锚点回顶部媒体台，原文跳阅读页（按需出现，权重对等） */}
        {(book.hasVideo || book.hasAudio || book.hasText) && (
          <div className="mt-3 flex gap-2">
            {book.hasVideo && (
              <a href="#media" className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-celadon-soft px-3 py-2 text-xs font-medium text-celadon-700 transition active:scale-95 dark:bg-celadon/20 dark:text-celadon-300">
                <Video size={14} /> 视频解读
              </a>
            )}
            {book.hasAudio && (
              <a href="#media" className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-celadon-soft px-3 py-2 text-xs font-medium text-celadon-700 transition active:scale-95 dark:bg-celadon/20 dark:text-celadon-300">
                <Headphones size={14} /> 音频伴读
              </a>
            )}
            {book.hasText && (
              <Link href={`/library/book/${book.id}/read`} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-celadon-soft px-3 py-2 text-xs font-medium text-celadon-700 transition active:scale-95 dark:bg-celadon/20 dark:text-celadon-300">
                <BookOpen size={14} /> 读原文
              </Link>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-500 tabular-nums dark:text-dark-text/55">
            <span className="flex items-center gap-1"><Stars value={book.rating} size={13} /> <span className="text-rouge">{book.rating.toFixed(1)}</span></span>
            <span className="h-1 w-1 rotate-45 bg-line dark:bg-white/15" />
            <span>{formatCount(book.readers)} 在读</span>
            <span className="h-1 w-1 rotate-45 bg-line dark:bg-white/15" />
            <span>约 {formatCount(book.words)} 字</span>
          </div>
          <div className="shrink-0">
            <button
              onClick={onFav}
              aria-pressed={fav}
              className={
                "flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-medium shadow-sm transition active:scale-95 " +
                (fav ? "bg-rouge/15 text-rouge" : "bg-celadon-soft text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300")
              }
            >
              {/* 单一克制反馈：收藏成功时图标一次性弹跳（去掉上方飞出的 like-burst，避免「弹+飞」叠加） */}
              <motion.span key={justFaved ? "on" : "off"} initial={justFaved ? { scale: 0.5 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 13 }}>
                <Heart size={14} className={fav ? "fill-rouge text-rouge" : ""} />
              </motion.span>
              {fav ? "已收藏" : "收藏"}
            </button>
          </div>
        </div>
      </div>

      {/* 简介（序） */}
      <div className="mx-4 mt-6">
        <h2 className="mb-2 flex items-center font-serif text-lg tracking-wide text-ink dark:text-dark-text">
          <span className="mr-2 h-4 w-[3px] rounded-full bg-celadon" /> 简介
        </h2>
        <p ref={summaryRef} className={"text-sm leading-7 text-ink-700 dark:text-dark-text/70 " + (expand ? "" : "line-clamp-3")}>{book.summary}</p>
        {/* 真实溢出才显示按钮（与 line-clamp-3 同口径），展开后保留「收起」 */}
        {(clamped || expand) && (
          <button onClick={() => setExpand((v) => !v)} className="mt-1.5 inline-flex items-center gap-0.5 text-xs text-celadon-700 dark:text-celadon-300">
            {expand ? "收起" : "展开全文"} <ChevronDown size={13} className={"transition-transform " + (expand ? "rotate-180" : "")} />
          </button>
        )}
      </div>

      {/* 文字全文 */}
      {book.hasText && (
        <div className="mt-6 px-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="flex items-center font-serif text-lg tracking-wide text-ink dark:text-dark-text">
              <span className="mr-2 h-4 w-[3px] rounded-full bg-celadon" /> 文字全文
            </h2>
            {chQ.data && <span className="text-xs text-ink-300">共 {chQ.data.length} 章</span>}
          </div>
          {chQ.isError ? (
            <ErrorState title="章节加载失败" subtitle="点击重试" onRetry={() => chQ.refetch()} />
          ) : chQ.isLoading ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : (
            <div className="divide-y divide-line dark:divide-white/10">
              {chQ.data?.map((c, i) => (
                <Link
                  key={c.id}
                  href={`/library/book/${book.id}/read?ch=${c.id}`}
                  className="-mx-2 flex animate-fade-up items-center gap-3 rounded-lg px-2 py-3.5 transition active:bg-snow/60 dark:active:bg-white/[0.03]"
                  style={{ animationDelay: `${i * 0.03}s` }}
                >
                  <span className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums " + (c.status === "reading" ? "bg-celadon text-snow" : "bg-celadon-soft text-celadon-700 dark:bg-celadon/15 dark:text-celadon-300")}>{c.no}</span>
                  <span className={"flex-1 text-sm " + (c.status === "reading" ? "font-medium text-celadon-700 dark:text-celadon-300" : "text-ink-700 dark:text-dark-text/85")}>{c.title}</span>
                  <span className="flex items-center gap-1">
                    {c.status === "reading" && <span className="text-[11px] text-celadon-700 dark:text-celadon-300">在读</span>}
                    {c.status === "read" && <Check size={14} className="text-ink-300" />}
                    <ChevronRight size={16} className="text-ink-300" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 书评预览 */}
      <div className="mt-6 px-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center font-serif text-lg tracking-wide text-ink dark:text-dark-text">
            <span className="mr-2 h-4 w-[3px] rounded-full bg-celadon" /> 读者评价
          </h2>
          <Link href={`/library/book/${book.id}/reviews`} className="flex items-center text-xs text-ink-300">
            全部 <ChevronRight size={14} />
          </Link>
        </div>
        {rvQ.data && rvQ.data.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-snow p-6 text-center text-sm text-ink-500 shadow-sm dark:bg-dark-card dark:text-dark-text/60">
            <Motif name="branch" className="w-16 text-celadon/30" />
            还没有书评，来写下第一条吧
          </div>
        ) : (
          <div className="space-y-3">
            {rvQ.data?.slice(0, 2).map((r) => (
              <div key={r.id} className="rounded-2xl bg-snow p-3.5 shadow-sm dark:bg-dark-card">
                <div className="flex items-center gap-2">
                  <Avatar seed={r.avatarSeed} name={r.nickname} src={r.avatarUrl} size={28} />
                  <span className="text-sm text-ink dark:text-dark-text">{r.nickname}</span>
                  <Stars value={r.rating} size={11} className="ml-auto" />
                </div>
                {r.title && <p className="mt-1.5 text-sm font-medium text-ink dark:text-dark-text">{r.title}</p>}
                <p className="mt-1 line-clamp-3 text-xs leading-5 text-ink-500 dark:text-dark-text/60">{r.content}</p>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-300">
                  <span className="flex items-center gap-1"><Heart size={11} /> {formatCount(r.likes)}</span>
                  <span>{formatDate(r.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => requireLogin(() => router.push(`/library/book/${book.id}/review/new`))}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-celadon py-2.5 text-sm text-celadon-700 transition active:scale-[0.99] dark:border-celadon/60 dark:text-celadon-300"
        >
          <PenLine size={15} /> 写书评
        </button>
      </div>
    </motion.main>
  );
}

/** Hero 背景：优先氛围大图（heroUrl），缺图回退模糊封面 */
function HeroBg({ book }: { book: Book }) {
  const [ok, setOk] = useState(true);
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-b from-celadon-soft via-celadon-soft/30 to-moon dark:from-celadon/12 dark:via-dark-bg/50 dark:to-dark-bg">
      {book.heroUrl && ok ? (
        <motion.img
          src={book.heroUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setOk(false)}
          initial={{ scale: 1.08, opacity: 0 }}
          animate={{ scale: 1.02, opacity: 0.28 }}
          transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
          className="h-full w-full object-cover will-change-transform"
        />
      ) : (
        <BookCover title="" seed={book.coverSeed} src={book.cover} className="h-full w-full scale-125 opacity-20 blur-2xl" showText={false} rounded="rounded-none" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-moon dark:to-dark-bg" />
    </div>
  );
}

/** 骨架贴合真实结构：全宽 hero（内含居中竖封面）+ 左对齐题名/作者/标签药丸/评分/简介，减少数据回来瞬间的重排闪烁 */
function DetailSkeleton() {
  return (
    <main className="relative min-h-[100dvh] pb-12">
      <BackBar />
      {/* 顶部全宽 hero 占位，其内居中竖封面骨架（对齐媒体台高度与封面宽比） */}
      <div className="relative flex h-[360px] w-full items-center justify-center overflow-hidden bg-celadon-soft/40 dark:bg-celadon/10">
        <Skeleton className="aspect-[3/4] w-[78%] max-w-[300px] rounded-3xl" />
      </div>
      {/* 题名区：题名 / 作者 / 一行标签药丸 / 评分行 */}
      <div className="px-4 pt-4">
        <Skeleton className="h-7 w-40 rounded" />
        <Skeleton className="mt-2 h-4 w-24 rounded" />
        <div className="mt-2 flex gap-1.5">
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-12 rounded-full" />
        </div>
        <Skeleton className="mt-3 h-4 w-52 rounded" />
      </div>
      {/* 简介块 */}
      <div className="mx-4 mt-6">
        <Skeleton className="h-5 w-16 rounded" />
        <Skeleton className="mt-3 h-20 w-full rounded-2xl" />
      </div>
    </main>
  );
}
