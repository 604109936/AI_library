"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ChevronLeft, Heart, ChevronRight, ChevronDown, PenLine, Check, BookOpen, Play } from "lucide-react";
import { getBook, getChapters } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { BookMediaHero } from "@/components/library/Players";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { formatCount, formatDate } from "@/lib/utils";
import { useAuth, useLibrary, useUI, requireLogin } from "@/lib/store";
import { useGoBack } from "@/components/shell/Header";
import type { Book } from "@/lib/types";

export default function BookDetail({ params }: { params: { id: string } }) {
  const { id } = params;
  const real = id.split("__")[0];
  const router = useRouter();
  const goBack = useGoBack();
  const toast = useUI((s) => s.toast);
  const user = useAuth((s) => s.user);
  const isFav = useLibrary((s) => s.isFav);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const myReviews = useLibrary((s) => s.myReviews);
  const readChapters = useLibrary((s) => s.readChapters);
  const progress = useLibrary((s) => s.progress);

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });

  const book = bookQ.data;
  const fav = book && user ? isFav(book.id) : false;
  const [favTick, setFavTick] = useState(0);
  const [expand, setExpand] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);

  // 我的那条书评（写/更新书评的依据）
  const myReview = myReviews.find((r) => r.bookId === real);
  // 章节「在读/已读」一律取真实阅读状态（store），不用写死的 c.status
  const readCh = readChapters[real] ?? [];
  const prog = progress[real];
  // 底部续读 CTA 用：仅认文字稿进度（progress 本就只写 text 模式，仍显式守一道）
  const textProg = prog && prog.mode === "text" && prog.pct > 0 ? prog : undefined;

  // 简介「展开全文」仅当收起（3 行）时确实溢出才显示
  useEffect(() => {
    const el = summaryRef.current;
    if (!el) return;
    setOverflow(el.scrollHeight - el.clientHeight > 4);
  }, [book?.summary]);

  if (bookQ.isLoading) return <DetailSkeleton />;
  // 书不存在（已下架/链接错误）≠ 网络错误：给 404 文案与出路，别让"重试"骗人（重试永远失败且无路可退）
  if (!bookQ.isError && bookQ.isSuccess && !book) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="font-serif text-lg text-ink dark:text-dark-text">书架上没有这一页</p>
        <p className="text-sm text-ink-500 dark:text-dark-text/55">这本书可能已被移走，或链接有误</p>
        <button onClick={() => router.push("/library")} className="rounded-full bg-celadon px-6 py-2.5 text-sm text-snow active:scale-95">回到泡馆</button>
      </main>
    );
  }
  if (bookQ.isError || !book) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center px-4">
        <ErrorState onRetry={() => bookQ.refetch()} />
        <button onClick={() => router.push("/library")} className="mt-3 text-sm text-celadon">回到泡馆</button>
      </main>
    );
  }

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
      className="min-h-[100dvh]"
    >
      {/* 媒体台 */}
      <div className="relative overflow-hidden">
        <HeroBg book={book} />
        <div className="pointer-events-none absolute left-1/2 top-[24%] h-72 w-72 -translate-x-1/2 rounded-full bg-celadon/18 blur-[80px]" />
        <button
          onClick={goBack}
          aria-label="返回"
          className="absolute left-2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-snow/80 text-ink backdrop-blur transition active:scale-90 dark:bg-dark-card/70 dark:text-dark-text"
          style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
        >
          <ChevronLeft size={24} />
        </button>
        <BookMediaHero book={book} />
      </div>

      {/* 题名 + 元信息（左对齐）· 右侧收藏药丸（本期不展示评分/在读人数） */}
      <div className="px-4 pt-4">
        <h1 className="font-serif text-[26px] leading-tight tracking-[0.01em] text-ink dark:text-dark-text">{book.title}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-dark-text/55">{book.author}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {book.tags.map((t) => (
            <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-500 dark:border-white/10 dark:text-dark-text/60">{t}</span>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-500 tabular-nums dark:text-dark-text/55">
            {book.hasText && <span>约 {formatCount(book.words)} 字</span>}
          </div>
          <div className="relative shrink-0">
            <button
              onClick={onFav}
              aria-pressed={fav}
              className={
                // before 伪元素纵向扩触区到 ≥40px，视觉不变
                "relative flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-medium shadow-sm transition before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] active:scale-95 " +
                (fav ? "bg-rouge/15 text-rouge dark:bg-rouge/25" : "bg-celadon-soft text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300")
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

      {/* 简介 */}
      <div className="mx-4 mt-6">
        <h2 className="mb-2 flex items-center font-serif text-lg tracking-wide text-ink dark:text-dark-text">
          <span className="mr-2 h-4 w-[3px] rounded-full bg-celadon" /> 简介
        </h2>
        <p ref={summaryRef} className={"text-sm leading-7 text-ink-700 dark:text-dark-text/70 " + (expand ? "" : "line-clamp-3")}>{book.summary}</p>
        {overflow && (
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
              {chQ.data?.map((c) => {
                const isRead = readCh.includes(c.id);
                const isReading = !isRead && prog?.mode === "text" && prog?.chapterId === c.id;
                return (
                <Link
                  key={c.id}
                  href={`/library/book/${book.id}/read?ch=${c.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3.5 transition active:bg-snow/60 dark:active:bg-white/[0.03]"
                >
                  <span className={"flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums " + (isReading ? "bg-celadon text-snow" : "bg-celadon-soft text-celadon-700 dark:bg-celadon/15 dark:text-celadon-300")}>{c.no === 0 ? "序" : c.no}</span>
                  <span className={"flex-1 text-sm " + (isReading ? "font-medium text-celadon-700 dark:text-celadon-300" : "text-ink-700 dark:text-dark-text/85")}>{c.title}</span>
                  <span className="flex items-center gap-1">
                    {isReading && <span className="text-[11px] text-celadon-700 dark:text-celadon-300">在读</span>}
                    {isRead && <Check size={14} className="text-ink-300" />}
                    <ChevronRight size={16} className="text-ink-300" />
                  </span>
                </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 我的评价（永远只有自己的一条） */}
      <div className="mt-6 px-4">
        <h2 className="mb-2 flex items-center font-serif text-lg tracking-wide text-ink dark:text-dark-text">
          <span className="mr-2 h-4 w-[3px] rounded-full bg-celadon" /> 我的评价
        </h2>
        {myReview ? (
          <div className="rounded-2xl bg-snow p-3.5 shadow-sm dark:bg-dark-card">
            <div className="flex items-center gap-2">
              {/* 头像/昵称直接用当前登录用户（本来就只展示本人）：书评行的快照在刷新重载后会丢自定义头像/旧昵称 */}
              <Avatar seed={user?.avatarSeed ?? myReview.avatarSeed} name={user?.nickname ?? myReview.nickname} src={user?.avatarUrl ?? myReview.avatarUrl} size={28} />
              <span className="text-sm text-ink dark:text-dark-text">{user?.nickname ?? myReview.nickname}</span>
              <span className="rounded bg-celadon-soft px-1.5 py-0.5 text-[10px] text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300">我的</span>
              <Stars value={myReview.rating} size={11} className="ml-auto" />
            </div>
            {myReview.title && <p className="mt-1.5 text-sm font-medium text-ink dark:text-dark-text">{myReview.title}</p>}
            <p className="mt-1 text-sm leading-6 text-ink-700 dark:text-dark-text/85">{myReview.content}</p>
            <p className="mt-2 text-[11px] text-ink-300">{formatDate(myReview.createdAt)}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-snow p-6 text-center text-sm text-ink-500 shadow-sm dark:bg-dark-card dark:text-dark-text/60">
            <Motif name="branch" className="w-16 text-celadon/30" />
            你还没有写过书评，记录下此刻的想法吧
          </div>
        )}
        <button
          onClick={() => requireLogin(() => router.push(`/library/book/${book.id}/review/new`))}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-celadon py-2.5 text-sm text-celadon-700 transition active:scale-[0.99] dark:border-celadon/60 dark:text-celadon-300"
        >
          <PenLine size={15} /> {myReview ? "更新书评" : "写书评"}
        </button>
      </div>

      {/* 底部常驻续读 CTA：sticky 占位在文档流末尾（滚到底回到原位，不遮挡上方内容） */}
      <div className="sticky bottom-0 z-20 mt-8 border-t border-line bg-snow/[0.92] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur dark:border-white/10 dark:bg-dark-card/[0.92]">
        {book.hasText ? (
          <Link
            href={`/library/book/${book.id}/read${textProg ? `?ch=${textProg.chapterId}` : ""}`}
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-celadon py-3 text-sm font-medium text-snow shadow-celadon transition active:scale-[0.98]"
          >
            <BookOpen size={16} />
            {textProg
              ? `继续阅读 · ${textProg.chapterNo === 0 ? "序" : `第${textProg.chapterNo}章`} · ${textProg.pct}%`
              : "开始阅读"}
          </Link>
        ) : (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-celadon py-3 text-sm font-medium text-snow shadow-celadon transition active:scale-[0.98]"
          >
            <Play size={16} className="fill-snow" />
            {book.hasVideo ? "播放视频" : "播放音频"}
          </button>
        )}
      </div>
    </motion.main>
  );
}

/** Hero 背景：优先氛围大图（heroUrl），缺图回退模糊封面 */
function HeroBg({ book }: { book: Book }) {
  const [ok, setOk] = useState(true);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-b from-celadon-soft via-celadon-soft/30 to-moon dark:from-celadon/12 dark:via-dark-bg/50 dark:to-dark-bg">
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
