"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronLeft, Heart, ChevronRight, ChevronDown, PenLine, Check } from "lucide-react";
import { getBook, getChapters, getBookReviews } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { BookMediaHero } from "@/components/library/Players";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { formatCount, formatDate } from "@/lib/utils";
import { useAuth, useLibrary, useUI, requireLogin } from "@/lib/store";
import type { Book } from "@/lib/types";

export default function BookDetail({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const toast = useUI((s) => s.toast);
  const user = useAuth((s) => s.user);
  const isFav = useLibrary((s) => s.isFav);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const myReviews = useLibrary((s) => s.myReviews);

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });
  const rvQ = useQuery({ queryKey: ["reviews", id, "hot"], queryFn: () => getBookReviews(id, "hot") });

  const book = bookQ.data;
  const fav = book && user ? isFav(book.id) : false;
  const [favTick, setFavTick] = useState(0);
  const [expand, setExpand] = useState(false);

  // 预览合并本地新发布书评，避免刚写完返回详情页看不到（与「全部」列表页一致）
  const reviewPreview = useMemo(() => {
    const real = id.split("__")[0];
    const mine = myReviews.filter((r) => r.bookId === real);
    return [...mine, ...(rvQ.data ?? [])].slice(0, 2);
  }, [myReviews, rvQ.data, id]);

  if (bookQ.isLoading) return <DetailSkeleton />;
  if (bookQ.isError || !book) return <ErrorState onRetry={() => bookQ.refetch()} />;

  function onFav() {
    requireLogin(() => {
      const now = toggleFav(book!.id);
      setFavTick((t) => t + 1);
      toast(now ? "已加入我的收藏" : "已取消收藏");
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
      <div className="relative overflow-hidden">
        <HeroBg book={book} />
        {/* 柔光 */}
        <div className="pointer-events-none absolute left-1/2 top-[24%] h-72 w-72 -translate-x-1/2 rounded-full bg-celadon/18 blur-[80px]" />
        <button
          onClick={() => router.back()}
          aria-label="返回"
          className="absolute left-2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-snow/80 text-ink backdrop-blur transition active:scale-90 dark:bg-dark-card/70 dark:text-dark-text"
          style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
        >
          <ChevronLeft size={24} />
        </button>
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
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-500 tabular-nums dark:text-dark-text/55">
            <span className="flex items-center gap-1"><Stars value={book.rating} size={13} /> <span className="text-rouge">{book.rating.toFixed(1)}</span></span>
            <span className="h-1 w-1 rotate-45 bg-line dark:bg-white/15" />
            <span>{formatCount(book.readers)} 在读</span>
            <span className="h-1 w-1 rotate-45 bg-line dark:bg-white/15" />
            <span>约 {formatCount(book.words)} 字</span>
          </div>
          <div className="relative shrink-0">
            <button
              onClick={onFav}
              aria-pressed={fav}
              className={
                "flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-medium shadow-sm transition active:scale-95 " +
                (fav ? "bg-rouge/15 text-rouge" : "bg-celadon-soft text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300")
              }
            >
              <motion.span key={favTick} initial={favTick ? { scale: 0.5 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 13 }}>
                <Heart size={14} className={fav ? "fill-rouge text-rouge" : ""} />
              </motion.span>
              {fav ? "已收藏" : "收藏"}
            </button>
            {fav && favTick > 0 && (
              <Heart key={favTick} size={14} className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 animate-like-burst fill-rouge text-rouge" />
            )}
          </div>
        </div>
      </div>

      {/* 简介（序） */}
      <div className="mx-4 mt-6">
        <h2 className="mb-2 flex items-center font-serif text-lg tracking-wide text-ink dark:text-dark-text">
          <span className="mr-2 h-4 w-[3px] rounded-full bg-celadon" /> 简介
        </h2>
        <p className={"text-sm leading-7 text-ink-700 dark:text-dark-text/70 " + (expand ? "" : "line-clamp-3")}>{book.summary}</p>
        {book.summary.length > 50 && (
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
        {rvQ.isError ? (
          <ErrorState title="书评加载失败" subtitle="点击重试" onRetry={() => rvQ.refetch()} />
        ) : rvQ.data && reviewPreview.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-snow p-6 text-center text-sm text-ink-500 shadow-sm dark:bg-dark-card dark:text-dark-text/60">
            <Motif name="branch" className="w-16 text-celadon/30" />
            还没有书评，来写下第一条吧
          </div>
        ) : (
          <div className="space-y-3">
            {reviewPreview.map((r) => (
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

function DetailSkeleton() {
  return (
    <main className="min-h-[100dvh] px-4 pt-16">
      <div className="flex flex-col items-center">
        <Skeleton className="aspect-[3/4] w-[78%] max-w-[300px] rounded-3xl" />
        <Skeleton className="mt-4 h-7 w-40 self-start rounded" />
        <Skeleton className="mt-2 h-4 w-24 self-start rounded" />
        <Skeleton className="mt-3 h-3 w-52 self-start rounded" />
      </div>
      <Skeleton className="mt-6 h-12 w-full rounded-2xl" />
      <Skeleton className="mt-5 h-16 w-full rounded-2xl" />
      <Skeleton className="mt-4 h-8 w-40 rounded" />
      <Skeleton className="mt-4 h-40 w-full rounded-2xl" />
    </main>
  );
}
