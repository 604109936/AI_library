"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Brain, TrendingUp, Feather, Landmark, Cpu, Sprout, ArrowRight } from "lucide-react";
import { getHome } from "@/lib/api";
import { BottomNav } from "@/components/shell/BottomNav";
import { BookCover } from "@/components/ui/BookCover";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { useAuth, useLibrary } from "@/lib/store";
import type { Category } from "@/lib/types";

const ICONS: Record<string, typeof Brain> = {
  Brain, TrendingUp, Feather, Landmark, Cpu, Sprout,
};

export default function LibraryHome() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["home"], queryFn: getHome });
  const user = useAuth((s) => s.user);
  const history = useLibrary((s) => s.history);

  return (
    <main className="min-h-[100dvh] pb-24">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-moon/90 px-4 backdrop-blur dark:bg-dark-bg/90">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-celadon-soft font-serif text-celadon-700">馆</span>
          <span className="font-serif text-lg text-ink dark:text-dark-text">AI 图书馆</span>
        </div>
        <Link href="/search" className="flex h-9 w-9 items-center justify-center rounded-full active:bg-line/50">
          <Search size={20} className="text-ink-700 dark:text-dark-text" />
        </Link>
      </header>

      {isLoading && <HomeSkeleton />}
      {isError && <ErrorState onRetry={() => refetch()} />}

      {data && (
        <div className="space-y-7 px-4 pt-2">
          {/* Banner */}
          <section className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 no-scrollbar">
            {data.banners.map((b) => (
              <div key={b.id} className="relative w-[78%] shrink-0 snap-center overflow-hidden rounded-2xl bg-snow p-4 shadow dark:bg-dark-card">
                <div className="flex gap-4">
                  <BookCover title={b.title} seed={b.coverSeed} className="w-[88px] shrink-0" showText={false} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <h3 className="font-serif text-lg text-ink dark:text-dark-text">{b.title}</h3>
                    <p className="mt-0.5 text-xs text-ink-500">{b.author}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">{b.intro}</p>
                    <Link
                      href={`/library/book/${b.id}/read`}
                      className="mt-auto inline-flex w-fit items-center gap-1 rounded-full bg-celadon px-4 py-1.5 text-xs text-snow shadow-celadon active:scale-95"
                    >
                      立即阅读 <ArrowRight size={13} />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </section>

          {/* 继续阅读 */}
          {user && history.length > 0 && (
            <section>
              <h2 className="mb-2 font-serif text-base text-ink dark:text-dark-text">继续阅读</h2>
              <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4">
                {history.slice(0, 3).map((h) => (
                  <Link
                    key={h.bookId}
                    href={`/library/book/${h.bookId}/read`}
                    className="flex w-[230px] shrink-0 items-center gap-3 rounded-lg bg-snow p-3 shadow-sm dark:bg-dark-card"
                  >
                    <BookCover title={h.bookTitle} seed={h.coverSeed} className="w-[44px] shrink-0" showText={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-sm text-ink dark:text-dark-text">{h.bookTitle}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
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
            <h2 className="mb-2 font-serif text-base text-ink dark:text-dark-text">分类</h2>
            <div className="grid grid-cols-2 gap-3">
              {data.categories.map((c: Category) => {
                const Icon = ICONS[c.icon] ?? Brain;
                return (
                  <Link
                    key={c.id}
                    href={`/library/category/${c.id}`}
                    className="flex items-center gap-3 rounded-lg bg-snow p-3.5 shadow-sm active:scale-[0.98] transition dark:bg-dark-card"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-celadon-soft">
                      <Icon size={18} className="text-celadon-700" />
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

          {/* 推荐 */}
          <section>
            <h2 className="mb-2 font-serif text-base text-ink dark:text-dark-text">{user ? "为你推荐" : "热门好书"}</h2>
            <div className="space-y-3">
              {data.recommend.map((b) => (
                <BookRow key={b.id} book={b} />
              ))}
            </div>
          </section>
        </div>
      )}

      <BottomNav active="library" />
    </main>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-7 px-4 pt-2">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
