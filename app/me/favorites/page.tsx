"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { EmptyState } from "@/components/ui/States";
import { ChevronDown, Check, Heart } from "lucide-react";
import { useLibrary, useUI } from "@/lib/store";
import { books } from "@/lib/mock/data";

// 收藏仅支持「最新收藏 / 最早收藏」（不按评分排序）
type Sort = "new" | "old";
const LABEL: Record<Sort, string> = { new: "最新收藏", old: "最早收藏" };

export default function FavoritesPage() {
  const favorites = useLibrary((s) => s.favorites);
  const toggleFav = useLibrary((s) => s.toggleFav);
  const toast = useUI((s) => s.toast);
  const [sort, setSort] = useState<Sort>("new");
  const [open, setOpen] = useState(false);

  const list = useMemo(() => {
    const arr = favorites
      .map((id) => books.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => !!b);
    if (sort === "old") return [...arr].reverse();
    return arr;
  }, [favorites, sort]);

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
        {list.length === 0 ? (
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
