"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Search, Brain, TrendingUp, Feather, Landmark, Cpu, Sprout, ArrowRight, RefreshCw } from "lucide-react";
import { getHome } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { BottomNav } from "@/components/shell/BottomNav";
import { BookCover } from "@/components/ui/BookCover";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { Motif } from "@/components/ui/Motif";
import { staggerContainer, staggerItem } from "@/components/shell/PageTransition";
import { useLibrary } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Book, Category } from "@/lib/types";

const ICONS: Record<string, typeof Brain> = { Brain, TrendingUp, Feather, Landmark, Cpu, Sprout };

export default function LibraryHome() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["home"], queryFn: getHome });
  const history = useLibrary((s) => s.history);
  const [recoPage, setRecoPage] = useState(0);
  const [heroActive, setHeroActive] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);

  // 推荐按整页（每页5本）翻，不重叠；不足一页时不展示"换一批"
  const recommendLen = data?.recommend?.length ?? 0;
  const recoPageCount = Math.max(1, Math.ceil(recommendLen / 5));
  const reco = useMemo(() => {
    const list = data?.recommend ?? [];
    const start = (recoPage % Math.max(1, Math.ceil(list.length / 5))) * 5;
    return list.slice(start, start + 5);
  }, [data, recoPage]);

  function onHeroScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const step = el.clientWidth * 0.88 + 12; // 单卡宽(88%) + gap-3
    setHeroActive(Math.round(el.scrollLeft / step));
  }

  return (
    <main className="min-h-[100dvh] pb-24">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-moon/90 px-4 backdrop-blur dark:bg-dark-bg/90">
        <div className="flex items-center gap-2">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-celadon text-snow">
            <span className="font-serif text-sm">馆</span>
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
          {/* Hero 大图轮播 */}
          <section>
            <div
              ref={heroRef}
              onScroll={onHeroScroll}
              className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar"
            >
              {data.banners.map((b, i) => (
                <HeroCard key={b.id} book={b} eager={i === 0} />
              ))}
            </div>
            {/* 分页指示器：仅多张时显示 */}
            {data.banners.length > 1 && (
              <div className="mt-2.5 flex items-center justify-center gap-1.5">
                {data.banners.map((b, i) => (
                  <span
                    key={b.id}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300",
                      i === heroActive ? "w-4 bg-celadon" : "w-1.5 bg-ink/15 dark:bg-white/20"
                    )}
                  />
                ))}
              </div>
            )}
          </section>

          {/* 继续阅读（游客本地历史也展示） */}
          {history.length > 0 && (
            <section>
              <h2 className="mb-2.5 font-serif text-base text-ink dark:text-dark-text">继续阅读</h2>
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 no-scrollbar">
                {history.slice(0, 5).map((h) => (
                  <Link
                    key={h.bookId}
                    href={h.mode === "text" ? `/library/book/${h.bookId}/read` : `/library/book/${h.bookId}`}
                    className="flex w-[248px] shrink-0 items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm dark:bg-dark-card"
                  >
                    <BookCover title={h.bookTitle} seed={h.coverSeed} src={h.cover} className="w-[46px] shrink-0" showText={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-sm text-ink dark:text-dark-text">{h.bookTitle}</p>
                      {h.author && <p className="mt-0.5 truncate text-caption text-ink-500 dark:text-dark-text/55">{h.author}</p>}
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line dark:bg-white/10">
                          <div className="h-full rounded-full bg-celadon" style={{ width: `${h.progress}%` }} />
                        </div>
                        <span className="text-micro text-ink-500 dark:text-dark-text/55">{h.progress}%</span>
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
                      <p className="text-caption text-ink-500 dark:text-dark-text/55">{c.count} 本</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* 推荐 */}
          <section>
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="font-serif text-base text-ink dark:text-dark-text">热门好书</h2>
              {recommendLen > 5 && (
                <button
                  onClick={() => setRecoPage((p) => (p + 1) % recoPageCount)}
                  className="flex items-center gap-1 text-xs text-celadon-700 active:scale-95 dark:text-celadon-300"
                >
                  <RefreshCw size={13} /> 换一批
                </button>
              )}
            </div>
            <motion.div
              key={recoPage}
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="space-y-3"
            >
              {reco.map((b) => (
                <motion.div key={b.id} variants={staggerItem}>
                  <BookRow book={b} />
                </motion.div>
              ))}
            </motion.div>
          </section>
        </div>
      )}

      <BottomNav active="library" />
    </main>
  );
}

/** 首屏 Hero 大卡：氛围底图 + 立体书封 + 书名 + 查看详情（进详情页） */
function HeroCard({ book, eager = false }: { book: Book; eager?: boolean }) {
  const [bgOk, setBgOk] = useState(true);
  return (
    <Link
      href={`/library/book/${book.id}`}
      className="relative h-[208px] w-[88%] shrink-0 snap-center overflow-hidden rounded-3xl shadow-lg"
    >
      {/* 氛围底图（缺图回退青瓷渐变） */}
      <div className="absolute inset-0 bg-gradient-to-br from-celadon-700 via-celadon to-celadon-300" />
      {book.heroUrl && bgOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={book.heroUrl}
          alt=""
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          onError={() => setBgOk(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent" />
      <Motif name="bamboo" className="absolute right-2 top-1 h-16 w-16 text-white/30" />

      <div className="relative flex h-full items-center gap-4 p-5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] tracking-wide text-white/80">{book.category} · 精选</span>
          <h3 className="mt-1 font-serif text-2xl leading-tight text-white drop-shadow-sm">{book.title}</h3>
          <p className="mt-1 line-clamp-1 text-sm text-white/85">{book.intro}</p>
          <span className="mt-4 inline-flex w-fit items-center gap-1 rounded-full bg-white px-4 py-1.5 text-xs font-medium text-celadon-700 shadow active:scale-95">
            查看详情 <ArrowRight size={12} />
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
      {/* Hero：与真实卡同为 88% 宽，露出右侧下一张的边，避免数据回来后位移 */}
      <Skeleton className="h-[208px] w-[88%] rounded-3xl" />
      <div className="space-y-2.5">
        <Skeleton className="h-5 w-16 rounded" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-5 w-20 rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
