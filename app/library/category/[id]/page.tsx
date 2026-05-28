"use client";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { getBooks } from "@/lib/api";
import { categories } from "@/lib/mock/data";
import { useAuth, useLibrary, requireLogin } from "@/lib/store";

type Status = "all" | "read" | "unread" | "reading";
type Sort = "new" | "rating" | "readers" | "words";
const SORT_LABEL: Record<Sort, string> = {
  new: "最新入库", rating: "评分最高", readers: "阅读人数最多", words: "字数最少",
};
const STATUS: { key: Status; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "read", label: "已读" },
  { key: "unread", label: "未读" },
  { key: "reading", label: "进行中" },
];

export default function CategoryPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const cat = categories.find((c) => c.id === id);
  const [status, setStatus] = useState<Status>("all");
  const [sort, setSort] = useState<Sort>("new");
  const [sortOpen, setSortOpen] = useState(false);
  const user = useAuth((s) => s.user);
  const history = useLibrary((s) => s.history);

  const q = useInfiniteQuery({
    queryKey: ["books", id, sort],
    queryFn: ({ pageParam }) => getBooks({ categoryId: id, sort, cursor: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = items.filter((b) => {
    if (status === "all") return true;
    const real = b.id.split("__")[0];
    const h = history.find((x) => x.bookId === real);
    if (status === "read") return h?.progress === 100;
    if (status === "reading") return !!h && h.progress > 0 && h.progress < 100;
    if (status === "unread") return !h;
    return true;
  });

  // 无限滚动
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const ob = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
    }, { rootMargin: "200px" });
    ob.observe(el);
    return () => ob.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage]); // eslint-disable-line

  function pickStatus(s: Status) {
    if (s !== "all" && !user) {
      requireLogin(() => setStatus(s));
      return;
    }
    setStatus(s);
  }

  return (
    <main className="min-h-[100dvh] pb-10">
      <Header title={cat?.name ?? "分类"} />
      <div className="px-4 -mt-1 mb-2 text-center text-xs text-ink-300">共 {cat?.count ?? 0} 本</div>

      {/* 筛选 + 排序 */}
      <div className="sticky top-14 z-20 flex items-center justify-between gap-2 bg-moon/90 px-4 py-2 backdrop-blur dark:bg-dark-bg/90">
        <div className="flex gap-1.5">
          {STATUS.map((s) => (
            <button
              key={s.key}
              onClick={() => pickStatus(s.key)}
              className={
                "rounded-full px-3 py-1 text-xs transition " +
                (status === s.key ? "bg-celadon text-snow" : "bg-snow text-ink-500 dark:bg-dark-card")
              }
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <button
            onClick={() => setSortOpen((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-ink-500"
          >
            {SORT_LABEL[sort]} <ChevronDown size={13} />
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-9 z-30 w-32 overflow-hidden rounded-lg border border-line bg-snow shadow-lg dark:bg-dark-card">
              {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSort(s); setSortOpen(false); }}
                  className={"block w-full px-3 py-2 text-left text-xs " + (sort === s ? "text-celadon" : "text-ink-700")}
                >
                  {SORT_LABEL[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 px-4 pt-2">
        {q.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        {q.isError && <ErrorState onRetry={() => q.refetch()} />}
        {!q.isLoading && filtered.length === 0 && (
          <EmptyState icon="book" title="这里还没有书" subtitle="换个筛选条件看看" />
        )}
        {filtered.map((b) => {
          const real = b.id.split("__")[0];
          const h = history.find((x) => x.bookId === real);
          return <BookRow key={b.id} book={b} progress={h && h.progress > 0 ? h.progress : undefined} />;
        })}
        <div ref={sentinel} className="h-8" />
        {q.isFetchingNextPage && <p className="py-2 text-center text-xs text-ink-300">加载中…</p>}
        {!q.hasNextPage && filtered.length > 0 && (
          <p className="py-2 text-center text-xs text-ink-300">已经到底了</p>
        )}
      </div>
    </main>
  );
}
