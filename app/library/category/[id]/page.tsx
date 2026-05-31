"use client";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpDown, Check } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { Motif, OrnDivider } from "@/components/ui/Motif";
import { getBooks } from "@/lib/api";
import { books, categories } from "@/lib/mock/data";
import { isFinished, realId } from "@/lib/utils";
import { useAuth, useLibrary, requireLogin } from "@/lib/store";

type Status = "all" | "read" | "unread" | "reading";
type Sort = "new" | "rating" | "readers";
const SORT_LABEL: Record<Sort, string> = {
  new: "最新入库", rating: "评分最高", readers: "阅读人数最多",
};
const STATUS: { key: Status; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "reading", label: "进行中" },
  { key: "read", label: "已读" },
  { key: "unread", label: "未读" },
];

export default function CategoryPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const cat = categories.find((c) => c.id === id);
  const total = books.filter((b) => b.categoryId === id).length; // 实时真实本数，替代写死的 cat.count
  const [status, setStatus] = useState<Status>("all");
  const [sort, setSort] = useState<Sort>("new");
  const [sortOpen, setSortOpen] = useState(false);
  const [navTitle, setNavTitle] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
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
    const h = history.find((x) => x.bookId === realId(b.id));
    if (status === "read") return !!h && isFinished(h.progress);
    if (status === "reading") return !!h && h.progress > 0 && !isFinished(h.progress);
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

  // 大标题滚出视口后，顶栏标题淡入（iOS 大标题收起，避免与大字重复）
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(([e]) => setNavTitle(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px", threshold: 0 });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  function pickStatus(s: Status) {
    if (s !== "all" && !user) {
      requireLogin(() => setStatus(s));
      return;
    }
    setStatus(s);
  }

  const stillLoading = q.isLoading || (filtered.length === 0 && q.hasNextPage);

  // 非法/失效分类直达兜底（改 URL 或失效深链）
  if (!cat) {
    return (
      <main className="min-h-[100dvh]">
        <Header title="分类" />
        <EmptyState
          icon="search"
          title="没有找到该分类"
          subtitle="它可能已下架，或地址有误"
          actionText="返回书库"
          actionHref="/library"
        />
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] pb-10">
      {/* 顶栏：不透明吸顶；大标题滚出后才淡入分类名，避免与下方大字重复 */}
      <Header title={cat.name} titleShown={navTitle} />
      {/* 装饰页头 */}
      <div className="relative flex flex-col items-center pb-3 pt-1">
        <Motif name="branch" className="pointer-events-none absolute -top-1 right-4 h-16 w-16 text-celadon/30" />
        <h1 ref={titleRef} className="font-serif text-2xl text-ink dark:text-dark-text">{cat.name}</h1>
        <div className="mt-1.5 flex items-center gap-2.5">
          <OrnDivider />
          <span className="text-xs text-ink-500 dark:text-dark-text/55">共 {total} 本</span>
          <OrnDivider />
        </div>
      </div>

      {/* 筛选 + 排序（吸附到安全区顶栏下沿） */}
      <div className="top-safe-14 sticky z-20 flex items-center justify-between gap-2 bg-moon/90 px-4 py-2 backdrop-blur dark:bg-dark-bg/90">
        <div className="relative">
          <button
            onClick={() => setSortOpen((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-ink-500 dark:border-white/10 dark:text-dark-text/70"
          >
            <ArrowUpDown size={13} /> {SORT_LABEL[sort]}
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setSortOpen(false)} />
              <div className="absolute left-0 top-9 z-30 w-36 overflow-hidden rounded-xl border border-line bg-snow shadow-lg dark:border-white/10 dark:bg-dark-card">
                {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                  <button
                    key={s}
                    aria-selected={sort === s}
                    onClick={() => { setSort(s); setSortOpen(false); }}
                    className={"flex w-full items-center justify-between px-3 py-2 text-left text-xs " + (sort === s ? "text-celadon" : "text-ink-700 dark:text-dark-text/80")}
                  >
                    {SORT_LABEL[s]}
                    {sort === s && <Check size={13} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex gap-1.5">
          {STATUS.map((s) => (
            <button
              key={s.key}
              aria-pressed={status === s.key}
              onClick={() => pickStatus(s.key)}
              className={
                "rounded-full px-3 py-1 text-xs transition " +
                (status === s.key ? "bg-celadon text-snow" : "bg-snow text-ink-500 dark:bg-dark-card dark:text-dark-text/70")
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-4 pt-3">
        {q.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {q.isError && <ErrorState onRetry={() => q.refetch()} />}
        {!stillLoading && !q.isError && filtered.length === 0 && (
          <EmptyState icon="book" title="这里还没有书" subtitle="换个筛选条件看看" />
        )}
        {filtered.map((b) => {
          const h = history.find((x) => x.bookId === realId(b.id));
          return (
            <div key={b.id} className="animate-fade-up">
              <BookRow book={b} progress={h && h.progress > 0 ? h.progress : undefined} />
            </div>
          );
        })}
        <div ref={sentinel} className="h-8" />
        {q.isFetchingNextPage && <p className="py-2 text-center text-xs text-ink-500 dark:text-dark-text/55">加载中…</p>}
        {!q.hasNextPage && filtered.length > 0 && (
          <p className="py-2 text-center text-xs text-ink-500 dark:text-dark-text/55">已经到底了</p>
        )}
      </div>
    </main>
  );
}
