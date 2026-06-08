"use client";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, Check } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { Motif, OrnDivider } from "@/components/ui/Motif";
import { BackToTop } from "@/components/ui/BackToTop";
import { getBooks } from "@/lib/api";
import { categories, chaptersByBook } from "@/lib/mock/data";
import { useAuth, useLibrary, requireLogin } from "@/lib/store";

type ReadingType = "av" | "text";
const TYPE_LABEL: Record<ReadingType, string> = { av: "音视频", text: "文字稿" };
type Status = "all" | "reading" | "read" | "unread";
const STATUS: { key: Status; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "reading", label: "进行中" },
  { key: "read", label: "已读" },
  { key: "unread", label: "未读" },
];

export default function CategoryPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const cat = categories.find((c) => c.id === id);
  // 阅读类型筛选（音视频/文字稿，默认音视频，列表按入库时间倒序）+ 状态筛选（全部/进行中/已读/未读）
  const [rtype, setRtype] = useState<ReadingType>("av");
  const [typeOpen, setTypeOpen] = useState(false);
  const [status, setStatus] = useState<Status>("all");
  const [navTitle, setNavTitle] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const user = useAuth((s) => s.user);
  const progress = useLibrary((s) => s.progress);
  const mediaPlayed = useLibrary((s) => s.mediaPlayed);
  const readChapters = useLibrary((s) => s.readChapters);

  const q = useInfiniteQuery({
    queryKey: ["books", id, rtype],
    queryFn: ({ pageParam }) => getBooks({ categoryId: id, readingType: rtype, cursor: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = items.filter((b) => {
    if (status === "all") return true;
    // 按「当前阅读类型」的进度判断状态：音视频看 mediaProgress、文字稿看 progress（二者分开统计）
    const done = doneOf(b.id);
    const pos = progOf(b.id);
    const ongoing = !done && pos !== undefined && pos > 0;
    if (status === "read") return done;
    if (status === "reading") return ongoing;
    if (status === "unread") return !done && !ongoing;
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

  // 稀疏筛选时若当前页为空但还有更多，自动续拉
  useEffect(() => {
    if (status !== "all" && filtered.length === 0 && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
  }, [status, filtered.length, q.hasNextPage, q.isFetchingNextPage]); // eslint-disable-line

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const ob = new IntersectionObserver(([e]) => setNavTitle(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px", threshold: 0 });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  function pickStatus(s: Status) {
    if (s !== "all" && !user) { requireLogin(() => setStatus(s)); return; }
    setStatus(s);
  }
  // 返回该书在当前阅读类型下的进度（0-100）；无任何记录返回 undefined
  function progOf(bookId: string): number | undefined {
    const r = bookId.split("__")[0];
    if (rtype === "av") {
      const mp = mediaPlayed[r]; // 进度=真实播放覆盖（按实际播过的记录，不看拖动位置）
      return mp === undefined ? undefined : Math.round(mp * 100);
    }
    const p = progress[r];
    return p && p.mode === "text" ? p.pct : undefined;
  }
  // 读完判定（口径 B）：音视频=真实播放≥90%；文字稿=所有章节读毕
  function doneOf(bookId: string): boolean {
    const r = bookId.split("__")[0];
    if (rtype === "av") return (mediaPlayed[r] ?? 0) >= 0.9;
    const total = chaptersByBook[r]?.length ?? 0;
    return total > 0 && (readChapters[r]?.length ?? 0) >= total;
  }

  const stillLoading = q.isLoading || (filtered.length === 0 && q.hasNextPage);

  return (
    <main className="min-h-[100dvh] pb-10">
      <Header title={cat?.name ?? "分类"} titleShown={navTitle} />
      <div className="relative flex flex-col items-center pb-3 pt-1">
        <Motif name="branch" className="pointer-events-none absolute -top-1 right-4 h-16 w-16 text-celadon/30" />
        <h1 ref={titleRef} className="font-serif text-2xl text-ink dark:text-dark-text">{cat?.name ?? "分类"}</h1>
        <div className="mt-1.5 flex items-center gap-2.5">
          <OrnDivider />
          <span className="text-xs text-ink-500 dark:text-dark-text/55">共 {cat?.count ?? 0} 本</span>
          <OrnDivider />
        </div>
      </div>

      {/* 阅读类型下拉 + 状态筛选 Tab */}
      <div className="sticky top-14 z-20 flex items-center justify-between gap-2 bg-moon/90 px-4 py-2 backdrop-blur dark:bg-dark-bg/90">
        <div className="relative">
          <button onClick={() => setTypeOpen((v) => !v)} className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs text-ink-500 dark:border-white/10 dark:text-dark-text/70">
            {TYPE_LABEL[rtype]} <ChevronDown size={13} />
          </button>
          {typeOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setTypeOpen(false)} />
              <div className="absolute left-0 top-9 z-30 w-28 overflow-hidden rounded-xl border border-line bg-snow shadow-lg dark:border-white/10 dark:bg-dark-card">
                {(Object.keys(TYPE_LABEL) as ReadingType[]).map((t) => (
                  <button key={t} onClick={() => { setRtype(t); setTypeOpen(false); }} className={"flex w-full items-center justify-between px-3 py-2 text-left text-xs " + (rtype === t ? "text-celadon" : "text-ink-700 dark:text-dark-text/80")}>
                    {TYPE_LABEL[t]}{rtype === t && <Check size={13} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex gap-1.5">
          {STATUS.map((s) => (
            <button key={s.key} aria-pressed={status === s.key} onClick={() => pickStatus(s.key)} className={"rounded-full px-3 py-1 text-xs transition " + (status === s.key ? "bg-celadon text-snow" : "bg-snow text-ink-500 dark:bg-dark-card dark:text-dark-text/70")}>
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
          const done = doneOf(b.id);
          const pos = progOf(b.id);
          const ongoing = !done && pos !== undefined && pos > 0;
          return (
            <div key={b.id} className="animate-fade-up">
              <BookRow book={b} progress={ongoing ? pos : undefined} statusLabel={done ? "已读" : !ongoing ? "未读" : undefined} />
            </div>
          );
        })}
        <div ref={sentinel} className="h-8" />
        {q.isFetchingNextPage && <p className="py-2 text-center text-xs text-ink-300">加载中…</p>}
      </div>
      <BackToTop />
    </main>
  );
}
