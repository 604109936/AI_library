"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { ChevronDown, Check, Heart } from "lucide-react";
import { useLibrary, useUI } from "@/lib/store";
import { getBooksByIds } from "@/lib/api";
import type { Book } from "@/lib/types";

// 收藏仅支持「最新收藏 / 最早收藏」（不按评分排序）
type Sort = "new" | "old";
const LABEL: Record<Sort, string> = { new: "最新收藏", old: "最早收藏" };

export default function FavoritesPage() {
  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const toast = useUI((s) => s.toast);
  const [sort, setSort] = useState<Sort>("new");
  const [open, setOpen] = useState(false);

  // 把收藏的 book_id 解析成真实书（按 id 批量查 Supabase）。
  // queryKey 固定 + 取消收藏时由本地 list 过滤：避免每次 toggleFav 生成新 key 导致整页闪骨架重拉
  const favKey = useMemo(() => [...favorites].sort().join(","), [favorites]);
  const booksQ = useQuery({
    queryKey: ["favBooks", favKey],
    queryFn: () => getBooksByIds(favorites),
    enabled: favorites.length > 0,
    placeholderData: (prev) => prev, // 收藏集变化时沿用旧数据渲染，不闪加载态
  });

  const list = useMemo(() => {
    const map = new Map((booksQ.data ?? []).map((b) => [b.id, b]));
    // favorites 已是「最新收藏在前」；按需反转
    const arr = favorites.map((id) => map.get(id)).filter((b): b is Book => !!b);
    return sort === "old" ? [...arr].reverse() : arr;
  }, [favorites, booksQ.data, sort]);

  const loading = favorites.length > 0 && booksQ.isLoading && !booksQ.data;

  return (
    <main className="min-h-[100dvh]">
      <Header
        title="我的收藏"
        right={
          <div className="relative">
            <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs text-ink-500 dark:text-dark-text/60">
              {LABEL[sort]} <ChevronDown size={13} />
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
                <div className="absolute right-0 top-8 z-30 w-32 overflow-hidden rounded-xl border border-line bg-snow shadow-lg dark:border-white/10 dark:bg-dark-card">
                  {(Object.keys(LABEL) as Sort[]).map((s) => (
                    <button key={s} onClick={() => { setSort(s); setOpen(false); }} className={"flex w-full items-center justify-between px-3 py-2 text-left text-xs " + (sort === s ? "text-celadon" : "text-ink-700 dark:text-dark-text/80")}>
                      {LABEL[s]}{sort === s && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        }
      />
      <RequireAuth>
        {loading ? (
          <div className="grid grid-cols-2 gap-4 p-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}
          </div>
        ) : booksQ.isError ? (
          // 网络失败 ≠ 没有收藏：显示假空态会让用户以为收藏丢了
          <ErrorState title="收藏加载失败" subtitle="请检查网络后重试" onRetry={() => booksQ.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState icon="book" title="还没有收藏任何书" subtitle="去泡馆发现好书吧" actionText="去泡馆逛逛" actionHref="/library" />
        ) : (
          <div className="grid grid-cols-2 gap-4 p-4">
            {list.map((b) => (
              <div key={b.id} className="relative">
                <Link href={`/library/book/${b.id}`} className="block transition active:scale-[0.98]">
                  <BookCover title={b.title} author={b.author} seed={b.coverSeed} src={b.cover} className="w-full" />
                  <h3 className="mt-2 truncate font-serif text-sm text-ink dark:text-dark-text">{b.title}</h3>
                  <p className="truncate text-xs text-ink-300">{b.author}</p>
                </Link>
                <button
                  aria-label="取消收藏"
                  onClick={() => { toggleFav(b.id); toast("已取消收藏"); }}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/30 backdrop-blur active:scale-90"
                >
                  <Heart size={15} className="fill-rouge text-rouge" />
                </button>
              </div>
            ))}
          </div>
        )}
      </RequireAuth>
    </main>
  );
}
