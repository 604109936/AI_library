"use client";
import { useMemo, useState } from "react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookGridCard } from "@/components/library/BookCard";
import { EmptyState } from "@/components/ui/States";
import { ChevronDown } from "lucide-react";
import { useLibrary } from "@/lib/store";
import { books } from "@/lib/mock/data";

type Sort = "new" | "old" | "rating";
const LABEL: Record<Sort, string> = { new: "最新收藏", old: "最早收藏", rating: "评分高到低" };

export default function FavoritesPage() {
  const favorites = useLibrary((s) => s.favorites);
  const [sort, setSort] = useState<Sort>("new");
  const [open, setOpen] = useState(false);

  const list = useMemo(() => {
    const arr = favorites
      .map((id) => books.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => !!b);
    if (sort === "rating") return [...arr].sort((a, b) => b.rating - a.rating);
    if (sort === "old") return [...arr].reverse();
    return arr;
  }, [favorites, sort]);

  return (
    <main className="min-h-[100dvh]">
      <Header
        title="我的收藏"
        right={
          <div className="relative">
            <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs text-ink-500">
              {LABEL[sort]} <ChevronDown size={13} />
            </button>
            {open && (
              <div className="absolute right-0 top-8 z-30 w-28 overflow-hidden rounded-lg border border-line bg-snow shadow-lg dark:bg-dark-card">
                {(Object.keys(LABEL) as Sort[]).map((s) => (
                  <button key={s} onClick={() => { setSort(s); setOpen(false); }} className={"block w-full px-3 py-2 text-left text-xs " + (sort === s ? "text-celadon" : "text-ink-700")}>
                    {LABEL[s]}
                  </button>
                ))}
              </div>
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
              <BookGridCard key={b.id} book={b} />
            ))}
          </div>
        )}
      </RequireAuth>
    </main>
  );
}
