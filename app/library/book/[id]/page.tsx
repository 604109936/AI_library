"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Heart, BookmarkPlus, Share2, ChevronRight, PenLine } from "lucide-react";
import { getBook, getChapters, getBookReviews } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { Avatar } from "@/components/ui/Avatar";
import { VideoMode, AudioMode } from "@/components/library/Players";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { formatCount } from "@/lib/utils";
import { useLibrary, useUI, requireLogin } from "@/lib/store";
import type { ReadingMode } from "@/lib/types";

export default function BookDetail({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const toast = useUI((s) => s.toast);
  const isFav = useLibrary((s) => s.isFav);
  const toggleFav = useLibrary((s) => s.toggleFav);

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });
  const rvQ = useQuery({ queryKey: ["reviews", id, "hot"], queryFn: () => getBookReviews(id, "hot") });

  const book = bookQ.data;
  const fav = book ? isFav(book.id) : false;

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
      toast(now ? "已加入我的收藏" : "已取消收藏");
    });
  }

  return (
    <main className="min-h-[100dvh] pb-10">
      {/* Hero */}
      <div className="relative">
        <div className="absolute inset-0 overflow-hidden">
          <BookCover title="" seed={book.coverSeed} className="h-full w-full scale-125 blur-2xl opacity-60" showText={false} rounded="rounded-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-moon dark:to-dark-bg" />
        </div>
        <button
          onClick={() => router.back()}
          className="absolute left-2 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-snow/70 backdrop-blur"
        >
          <ChevronLeft size={24} className="text-ink" />
        </button>
        <div className="relative flex flex-col items-center px-4 pt-16 pb-3">
          <BookCover title={book.title} seed={book.coverSeed} className="w-32 shadow-lg" showText={false} />
          <h1 className="mt-4 font-serif text-2xl text-ink dark:text-dark-text">{book.title}</h1>
          <p className="mt-1 text-sm text-ink-500">{book.author}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {book.tags.map((t) => (
              <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-500">{t}</span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-ink-500">
            <span className="flex items-center gap-1"><Stars value={book.rating} size={13} /> {book.rating.toFixed(1)}</span>
            <span>·</span>
            <span>{formatCount(book.readers)} 在读</span>
            <span>·</span>
            <span>约 {formatCount(book.words)} 字</span>
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="mx-4 flex items-center justify-around rounded-xl bg-snow py-3 shadow-sm dark:bg-dark-card">
        <button onClick={onFav} className="flex flex-col items-center gap-1 active:scale-95">
          <Heart size={22} className={fav ? "fill-rouge text-rouge" : "text-ink-500"} />
          <span className="text-[11px] text-ink-500">{fav ? "已收藏" : "收藏"}</span>
        </button>
        <button onClick={() => toast("已加入书架")} className="flex flex-col items-center gap-1 active:scale-95">
          <BookmarkPlus size={22} className="text-ink-500" />
          <span className="text-[11px] text-ink-500">书架</span>
        </button>
        <button onClick={() => toast("分享功能即将上线", "info")} className="flex flex-col items-center gap-1 active:scale-95">
          <Share2 size={22} className="text-ink-500" />
          <span className="text-[11px] text-ink-500">分享</span>
        </button>
      </div>

      {/* 三模式 Tab */}
      <div className="mt-4 px-4">
        <div className="flex gap-5 border-b border-line">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={
                "relative pb-2 text-sm transition " +
                (activeMode === m.key ? "font-medium text-celadon" : "text-ink-500")
              }
            >
              {m.label}
              {activeMode === m.key && <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-celadon" />}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {chQ.data && activeMode === "video" && <VideoMode book={book} chapters={chQ.data} />}
          {chQ.data && activeMode === "audio" && <AudioMode book={book} chapters={chQ.data} />}
          {chQ.data && activeMode === "text" && (
            <div className="divide-y divide-line">
              {chQ.data.map((c) => (
                <Link
                  key={c.id}
                  href={`/library/book/${book.id}/read?ch=${c.id}`}
                  className="flex items-center justify-between py-3"
                >
                  <span className="text-sm text-ink-700 dark:text-dark-text">第{c.no}章 {c.title}</span>
                  <ChevronRight size={16} className="text-ink-300" />
                </Link>
              ))}
            </div>
          )}
          {chQ.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
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
        <div className="space-y-3">
          {rvQ.data?.slice(0, 2).map((r) => (
            <div key={r.id} className="rounded-lg bg-snow p-3 shadow-sm dark:bg-dark-card">
              <div className="flex items-center gap-2">
                <Avatar seed={r.avatarSeed} name={r.nickname} size={28} />
                <span className="text-sm text-ink dark:text-dark-text">{r.nickname}</span>
                <Stars value={r.rating} size={11} className="ml-auto" />
              </div>
              {r.title && <p className="mt-1.5 text-sm font-medium text-ink dark:text-dark-text">{r.title}</p>}
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-ink-500">{r.content}</p>
            </div>
          ))}
        </div>
        <button
          onClick={() => requireLogin(() => router.push(`/library/book/${book.id}/review/new`))}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-celadon py-2.5 text-sm text-celadon-700 active:scale-[0.99]"
        >
          <PenLine size={15} /> 写书评
        </button>
      </div>
    </main>
  );
}

function DetailSkeleton() {
  return (
    <main className="min-h-[100dvh] px-4 pt-16">
      <div className="flex flex-col items-center">
        <Skeleton className="h-44 w-32 rounded-lg" />
        <Skeleton className="mt-4 h-6 w-32 rounded" />
        <Skeleton className="mt-2 h-4 w-24 rounded" />
      </div>
      <Skeleton className="mt-6 h-14 w-full rounded-xl" />
      <Skeleton className="mt-4 h-40 w-full rounded-xl" />
    </main>
  );
}
