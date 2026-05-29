"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronLeft, Heart, ChevronRight, ChevronDown, PenLine, Clock, Check } from "lucide-react";
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

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });
  const rvQ = useQuery({ queryKey: ["reviews", id, "hot"], queryFn: () => getBookReviews(id, "hot") });

  const book = bookQ.data;
  const fav = book && user ? isFav(book.id) : false;
  const [favTick, setFavTick] = useState(0);
  const [expand, setExpand] = useState(false);

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
      <div className="relative min-h-[76vh] overflow-hidden">
        <HeroBg book={book} />
        {/* 银幕柔光 */}
        <div className="pointer-events-none absolute left-1/2 top-[20%] h-80 w-80 -translate-x-1/2 rounded-full bg-celadon/25 blur-[90px]" />
        <button
          onClick={() => router.back()}
          aria-label="返回"
          className="absolute left-2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-snow backdrop-blur transition active:scale-90"
          style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
        >
          <ChevronLeft size={24} />
        </button>
        <BookMediaHero book={book} />
      </div>

      {/* 题名 */}
      <div className="flex flex-col items-center px-4 pt-4 text-center">
        <h1 className="font-serif text-[26px] leading-tight tracking-[0.01em] text-ink dark:text-dark-text">{book.title}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-dark-text/55">{book.author}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {book.tags.map((t, i) => (
            <span key={t} className="animate-fade-up rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-500 dark:border-white/10 dark:text-dark-text/60" style={{ animationDelay: `${i * 0.04}s` }}>{t}</span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs text-ink-500 tabular-nums dark:text-dark-text/55">
          <span className="flex items-center gap-1"><Stars value={book.rating} size={13} /> <span className="text-rouge">{book.rating.toFixed(1)}</span></span>
          <span className="h-1 w-1 rotate-45 bg-line dark:bg-white/15" />
          <span>{formatCount(book.readers)} 在读</span>
          <span className="h-1 w-1 rotate-45 bg-line dark:bg-white/15" />
          <span>约 {formatCount(book.words)} 字</span>
          <span className="h-1 w-1 rotate-45 bg-line dark:bg-white/15" />
          <span className="flex items-center gap-0.5"><Clock size={12} /> {book.durationMin} 分钟</span>
        </div>
      </div>

      {/* 收藏（胭脂藏书印） */}
      <div className="relative mx-4 mt-4">
        <button
          onClick={onFav}
          aria-pressed={fav}
          className={
            "flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium shadow-sm transition active:scale-[0.99] " +
            (fav ? "bg-rouge/10 text-rouge dark:bg-rouge/15" : "bg-snow text-ink dark:bg-dark-card dark:text-dark-text")
          }
        >
          <motion.span key={favTick} initial={favTick ? { scale: 0.5 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 13 }}>
            <Heart size={18} className={fav ? "fill-rouge text-rouge" : ""} />
          </motion.span>
          {fav ? "已收藏" : "收藏"}
        </button>
        {fav && favTick > 0 && (
          <Heart key={favTick} size={16} className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 animate-like-burst fill-rouge text-rouge" />
        )}
      </div>

      {/* 简介（序） */}
      <div className="mx-4 mt-6">
        <h2 className="mb-2 flex items-center font-serif text-base text-ink dark:text-dark-text">
          <span className="mr-2.5 h-3.5 w-0.5 rounded bg-brass" /> 简介
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
            <h2 className="flex items-center font-serif text-base text-ink dark:text-dark-text">
              <span className="mr-2.5 h-3.5 w-0.5 rounded bg-brass" /> 文字全文
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
                  className="relative -mx-2 flex animate-fade-up items-center gap-3 rounded-lg px-2 py-3.5 transition active:bg-snow/60 dark:active:bg-white/[0.03]"
                  style={{ animationDelay: `${i * 0.03}s` }}
                >
                  {c.status === "reading" && <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-celadon" />}
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-celadon-soft text-[11px] tabular-nums text-celadon-700 dark:bg-celadon/15 dark:text-celadon-300">{c.no}</span>
                  <span className="flex-1 text-sm text-ink-700 dark:text-dark-text/85">{c.title}</span>
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
          <h2 className="flex items-center font-serif text-base text-ink dark:text-dark-text">
            <span className="mr-2.5 h-3.5 w-0.5 rounded bg-brass" /> 读者评价
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
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-b from-[#283129] via-celadon-700/15 to-moon dark:from-black dark:via-dark-bg/70 dark:to-dark-bg">
      {book.heroUrl && ok ? (
        <motion.img
          src={book.heroUrl}
          alt=""
          onError={() => setOk(false)}
          initial={{ scale: 1.12, filter: "brightness(0.7)" }}
          animate={{ scale: 1.05, filter: "brightness(0.95)" }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className="h-full w-full object-cover opacity-45 will-change-transform"
        />
      ) : (
        <BookCover title="" seed={book.coverSeed} src={book.cover} className="h-full w-full scale-125 opacity-30 blur-2xl" showText={false} rounded="rounded-none" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-moon dark:to-dark-bg" />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <main className="min-h-[100dvh] px-4 pt-16">
      <div className="flex flex-col items-center">
        <Skeleton className="aspect-[9/16] w-[66%] max-w-[268px] rounded-3xl" />
        <Skeleton className="mt-4 h-7 w-40 rounded" />
        <Skeleton className="mt-2 h-4 w-24 rounded" />
        <Skeleton className="mt-3 h-3 w-52 rounded" />
      </div>
      <Skeleton className="mt-6 h-12 w-full rounded-2xl" />
      <Skeleton className="mt-5 h-16 w-full rounded-2xl" />
      <Skeleton className="mt-4 h-8 w-40 rounded" />
      <Skeleton className="mt-4 h-40 w-full rounded-2xl" />
    </main>
  );
}
