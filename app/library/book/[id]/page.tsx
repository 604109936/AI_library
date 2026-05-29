"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronLeft, Heart, ChevronRight, PenLine, Clock, Check } from "lucide-react";
import { getBook, getChapters, getBookReviews } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { Avatar } from "@/components/ui/Avatar";
import { VideoMode, AudioMode } from "@/components/library/Players";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { formatCount, formatDate } from "@/lib/utils";
import { useAuth, useLibrary, useUI, requireLogin } from "@/lib/store";
import type { Book, ReadingMode } from "@/lib/types";

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

  const modes = useMemo(() => {
    if (!book) return [] as { key: ReadingMode; label: string }[];
    const m: { key: ReadingMode; label: string }[] = [];
    if (book.hasVideo) m.push({ key: "video", label: "视频解读" });
    if (book.hasAudio) m.push({ key: "audio", label: "音频伴读" });
    if (book.hasText) m.push({ key: "text", label: "文字全文" });
    return m;
  }, [book]);
  const [mode, setMode] = useState<ReadingMode | null>(null);
  const activeMode = mode ?? (book?.hasText ? "text" : modes[0]?.key) ?? "text";

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
      {/* Hero */}
      <div className="relative">
        <HeroBg book={book} />
        <button
          onClick={() => router.back()}
          aria-label="返回"
          className="absolute left-2 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-snow/70 backdrop-blur dark:bg-dark-card/70"
        >
          <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
        </button>
        <div className="relative flex flex-col items-center px-4 pt-16 pb-3">
          <div className="relative">
            <BookCover title={book.title} author={book.author} seed={book.coverSeed} src={book.cover} className="w-32 shadow-2xl" />
            {/* 书脊伪 3D */}
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-gradient-to-r from-black/25 to-transparent" />
          </div>
          <h1 className="mt-4 font-serif text-2xl text-ink dark:text-dark-text">{book.title}</h1>
          <p className="mt-1 text-sm text-ink-500 dark:text-dark-text/55">{book.author}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {book.tags.map((t) => (
              <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-500 dark:border-white/10 dark:text-dark-text/60">{t}</span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-500 dark:text-dark-text/55">
            <span className="flex items-center gap-1"><Stars value={book.rating} size={13} /> {book.rating.toFixed(1)}</span>
            <span>·</span>
            <span>{formatCount(book.readers)} 在读</span>
            <span>·</span>
            <span>约 {formatCount(book.words)} 字</span>
            <span>·</span>
            <span className="flex items-center gap-0.5"><Clock size={12} /> {book.durationMin} 分钟</span>
          </div>
        </div>
      </div>

      {/* 操作栏：收藏（胭脂爱心回弹） */}
      <div className="mx-4">
        <button
          onClick={onFav}
          aria-pressed={fav}
          className={
            "flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium shadow-sm transition active:scale-[0.99] " +
            (fav ? "bg-rouge/10 text-rouge" : "bg-snow text-ink dark:bg-dark-card dark:text-dark-text")
          }
        >
          <motion.span key={favTick} initial={favTick ? { scale: 0.5 } : false} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 13 }}>
            <Heart size={18} className={fav ? "fill-rouge text-rouge" : ""} />
          </motion.span>
          {fav ? "已收藏" : "收藏"}
        </button>
      </div>

      {/* 简介 */}
      <div className="mx-4 mt-5">
        <h2 className="mb-1.5 font-serif text-base text-ink dark:text-dark-text">简介</h2>
        <p className={"text-sm leading-6 text-ink-700 dark:text-dark-text/70 " + (expand ? "" : "line-clamp-3")}>{book.summary}</p>
        {book.summary.length > 50 && (
          <button onClick={() => setExpand((v) => !v)} className="mt-1 text-xs text-celadon-700 dark:text-celadon-300">
            {expand ? "收起" : "展开全文"}
          </button>
        )}
      </div>

      {/* 三模式 Tab */}
      <div className="mt-5 px-4">
        <div className="flex gap-5 border-b border-line dark:border-white/10">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={"relative pb-2 text-sm transition " + (activeMode === m.key ? "font-medium text-celadon" : "text-ink-500 dark:text-dark-text/55")}
            >
              {m.label}
              {activeMode === m.key && (
                <motion.span layoutId="detailTab" transition={{ type: "spring", stiffness: 380, damping: 30 }} className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-celadon" />
              )}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {chQ.isError && <ErrorState title="章节加载失败" subtitle="点击重试" onRetry={() => chQ.refetch()} />}
          {chQ.data && activeMode === "video" && <VideoMode book={book} chapters={chQ.data} />}
          {chQ.data && activeMode === "audio" && <AudioMode book={book} chapters={chQ.data} />}
          {chQ.data && activeMode === "text" && (
            <div className="divide-y divide-line dark:divide-white/10">
              {chQ.data.map((c, i) => (
                <Link
                  key={c.id}
                  href={`/library/book/${book.id}/read?ch=${c.id}`}
                  className="flex animate-fade-up items-center justify-between py-3"
                  style={{ animationDelay: `${i * 0.03}s` }}
                >
                  <span className="text-sm text-ink-700 dark:text-dark-text/85">第{c.no}章 {c.title}</span>
                  <span className="flex items-center gap-1">
                    {c.status === "reading" && <span className="text-[11px] text-celadon">在读</span>}
                    {c.status === "read" && <Check size={14} className="text-ink-300" />}
                    <ChevronRight size={16} className="text-ink-300" />
                  </span>
                </Link>
              ))}
            </div>
          )}
          {chQ.isLoading && <Skeleton className="h-40 w-full rounded-2xl" />}
        </div>
      </div>

      {/* 书评预览 */}
      <div className="mt-6 px-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-serif text-base text-ink dark:text-dark-text">读者评价</h2>
          <Link href={`/library/book/${book.id}/reviews`} className="flex items-center text-xs text-ink-300">
            全部 <ChevronRight size={14} />
          </Link>
        </div>
        {rvQ.data && rvQ.data.length === 0 ? (
          <div className="rounded-2xl bg-snow p-5 text-center text-sm text-ink-500 shadow-sm dark:bg-dark-card dark:text-dark-text/60">
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
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-celadon py-2.5 text-sm text-celadon-700 active:scale-[0.99] dark:text-celadon-300"
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
    <div className="absolute inset-0 overflow-hidden">
      {book.heroUrl && ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={book.heroUrl} alt="" onError={() => setOk(false)} className="h-full w-full scale-105 object-cover opacity-80" />
      ) : (
        <BookCover title="" seed={book.coverSeed} src={book.cover} className="h-full w-full scale-125 opacity-60 blur-2xl" showText={false} rounded="rounded-none" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-moon dark:to-dark-bg" />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <main className="min-h-[100dvh] px-4 pt-16">
      <div className="flex flex-col items-center">
        <Skeleton className="h-44 w-32 rounded-lg" />
        <Skeleton className="mt-4 h-6 w-32 rounded" />
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
