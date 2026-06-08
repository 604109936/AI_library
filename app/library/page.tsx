"use client";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Search, Brain, TrendingUp, Feather, Landmark, Cpu, Sprout, Play } from "lucide-react";
import { getHome } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { BottomNav } from "@/components/shell/BottomNav";
import { BookCover } from "@/components/ui/BookCover";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { Motif } from "@/components/ui/Motif";
import { BackToTop } from "@/components/ui/BackToTop";
import { staggerContainer, staggerItem } from "@/components/shell/PageTransition";
import { useLibrary } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Book, Category } from "@/lib/types";

const ICONS: Record<string, typeof Brain> = { Brain, TrendingUp, Feather, Landmark, Cpu, Sprout };

export default function LibraryHome() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["home"], queryFn: getHome });
  const hydrated = useLibrary((s) => s.hydrated);
  const history = useLibrary((s) => s.history);

  // 继续阅读：仅「文字稿」且未读完，按最近阅读在前，最多 5 本；无则整块不显示
  const continueList = hydrated ? history.filter((h) => h.mode === "text" && h.progress < 100).slice(0, 5) : [];
  // 热门好书：按「入库时间」由远到近（API 已排序），自动过滤掉已读完的，取 20 本
  const readDone = new Set(history.filter((h) => h.progress >= 100).map((h) => h.bookId));
  const hot = (data?.recommend ?? []).filter((b) => !readDone.has(b.id.split("__")[0])).slice(0, 20);

  return (
    <main className="min-h-[100dvh] pb-24">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-moon/90 px-4 backdrop-blur dark:bg-dark-bg/90">
        <div className="flex items-center gap-2">
          <span className="relative h-8 w-8 overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/emblem.webp" alt="馆徽" className="h-full w-full object-cover" />
          </span>
          <span className="font-serif text-lg text-ink dark:text-dark-text">AI 图书馆</span>
        </div>
        <Link href="/search" aria-label="搜索" className="flex h-9 w-9 items-center justify-center rounded-full active:bg-line/50">
          <Search size={20} className="text-ink-700 dark:text-dark-text" />
        </Link>
      </header>

      {isLoading && <HomeSkeleton />}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {data && (
        <div className="space-y-7 px-4 pt-3">
          {/* Banner：每个分类最新入库一本（共 6 本） */}
          <section className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
            {data.banners.map((b) => (
              <HeroCard key={b.id} book={b} />
            ))}
          </section>

          {/* 继续阅读（仅文字稿未读完；游客本地历史也展示）· 等持久化水合后再渲染，避免首帧闪烁 */}
          {continueList.length > 0 && (
            <section>
              <h2 className="mb-2.5 font-serif text-base text-ink dark:text-dark-text">继续阅读</h2>
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 no-scrollbar">
                {continueList.map((h) => (
                  <Link
                    key={h.bookId}
                    href={`/library/book/${h.bookId}/read`}
                    className="flex w-[248px] shrink-0 items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm dark:bg-dark-card"
                  >
                    <BookCover title={h.bookTitle} seed={h.coverSeed} src={h.cover} className="w-[46px] shrink-0" showText={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-sm text-ink dark:text-dark-text">{h.bookTitle}</p>
                      {h.author && <p className="mt-0.5 truncate text-[11px] text-ink-300">{h.author}</p>}
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line dark:bg-white/10">
                          <div className="h-full rounded-full bg-celadon" style={{ width: `${h.progress}%` }} />
                        </div>
                        <span className="text-[10px] text-ink-300">{h.progress}%</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 分类网格 */}
          <section>
            <h2 className="mb-2.5 font-serif text-base text-ink dark:text-dark-text">分类</h2>
            <div className="grid grid-cols-2 gap-3">
              {data.categories.map((c: Category) => {
                const Icon = ICONS[c.icon] ?? Brain;
                return (
                  <Link
                    key={c.id}
                    href={`/library/category/${c.id}`}
                    className="flex items-center gap-3 rounded-2xl bg-snow p-3.5 shadow-sm transition active:scale-[0.98] dark:bg-dark-card"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-celadon-soft dark:bg-celadon/15">
                      <Icon size={18} className="text-celadon-700 dark:text-celadon-300" />
                    </span>
                    <div>
                      <p className="text-sm text-ink dark:text-dark-text">{c.name}</p>
                      <p className="text-[11px] text-ink-300">{c.count} 本</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* 热门好书：完整 20 本，触底「回到顶部」 */}
          <section>
            <h2 className="mb-2.5 font-serif text-base text-ink dark:text-dark-text">热门好书</h2>
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-3">
              {hot.map((b) => (
                <motion.div key={b.id} variants={staggerItem}>
                  <BookRow book={b} />
                </motion.div>
              ))}
            </motion.div>
          </section>
        </div>
      )}

      <BackToTop />
      <BottomNav active="library" />
    </main>
  );
}

/** 首屏 Hero 大卡：氛围底图 + 立体书封 + 书名 + 立即阅读（进详情页） */
function HeroCard({ book }: { book: Book }) {
  const [bgOk, setBgOk] = useState(true);
  return (
    <Link
      href={`/library/book/${book.id}`}
      className="relative h-[208px] w-[88%] shrink-0 snap-center overflow-hidden rounded-3xl shadow-lg"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-celadon-700 via-celadon to-celadon-300" />
      {book.heroUrl && bgOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={book.heroUrl}
          alt=""
          onError={() => setBgOk(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent" />
      <Motif name="bamboo" className="absolute right-2 top-1 h-16 w-16 text-white/30" />

      <div className="relative flex h-full items-center gap-4 p-5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] tracking-wide text-white/80">{book.category} · 新书</span>
          <h3 className="mt-1 font-serif text-2xl leading-tight text-white drop-shadow-sm">{book.title}</h3>
          <p className="mt-1 line-clamp-1 text-sm text-white/85">{book.intro}</p>
          <span className="mt-4 inline-flex w-fit items-center gap-1 rounded-full bg-white px-4 py-1.5 text-xs font-medium text-celadon-700 shadow active:scale-95">
            <Play size={12} className="fill-celadon-700" /> 立即阅读
          </span>
        </div>
        <BookCover
          title={book.title}
          seed={book.coverSeed}
          src={book.cover}
          showText={false}
          className={cn("w-[104px] shrink-0 rotate-[3deg] shadow-2xl")}
        />
      </div>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-7 px-4 pt-3">
      <Skeleton className="h-[208px] w-full rounded-3xl" />
      <div className="flex gap-3">
        <Skeleton className="h-20 w-[248px] shrink-0 rounded-2xl" />
        <Skeleton className="h-20 w-[120px] shrink-0 rounded-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
