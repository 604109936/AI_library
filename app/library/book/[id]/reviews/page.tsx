"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Heart, PenLine } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { Avatar } from "@/components/ui/Avatar";
import { Stars } from "@/components/ui/Stars";
import { Skeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { getBookReviews } from "@/lib/api";
import { formatDate, formatCount, realId } from "@/lib/utils";
import { useLibrary, requireLogin } from "@/lib/store";
import type { Review } from "@/lib/types";

export default function ReviewListPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [sort, setSort] = useState<"hot" | "new">("hot");
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["reviews", id, sort], queryFn: () => getBookReviews(id, sort) });
  const liked = useLibrary((s) => s.likedReviews);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const myReviews = useLibrary((s) => s.myReviews);

  const list = useMemo(() => {
    const mine = myReviews.filter((r) => r.bookId === realId(id));
    const base = data ?? [];
    const merged = [...mine, ...base];
    // 排序口径：最热按点赞、最新按时间
    const cmp = (a: Review, b: Review) =>
      sort === "hot" ? b.likes - a.likes : +new Date(b.createdAt) - +new Date(a.createdAt);
    // 「我的」书评始终置顶，避免新发书评在「最热」下点赞数为 0 沉底找不到
    const ours = merged.filter((r) => r.mine).sort(cmp);
    const others = merged.filter((r) => !r.mine).sort(cmp);
    return [...ours, ...others];
  }, [data, myReviews, id, sort]);

  return (
    <main className="min-h-[100dvh]">
      <Header
        title="读者评价"
        right={
          <div className="flex overflow-hidden rounded-full bg-snow text-xs dark:bg-dark-card">
            {(["hot", "new"] as const).map((s) => (
              <button key={s} onClick={() => setSort(s)} className={"px-3 py-1 " + (sort === s ? "bg-celadon text-snow" : "text-ink-500 dark:text-dark-text/70")}>
                {s === "hot" ? "最热" : "最新"}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-3 p-4 pb-28">
        {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {/* 加载失败错误态：避免把请求失败误显为「还没有书评」空态 */}
        {!isLoading && isError && <ErrorState onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState icon="review" title="还没有书评" subtitle="成为第一个分享想法的人" />
        )}
        {list.map((r) => {
          const isLiked = liked.includes(r.id);
          return (
            <div key={r.id} className={"animate-fade-up rounded-2xl bg-snow p-3.5 shadow-sm dark:bg-dark-card" + (r.mine ? " ring-1 ring-celadon/30" : "")}>{/* 「我的」书评青瓷描边，便于一眼定位 */}
              <div className="flex items-center gap-2">
                <Avatar seed={r.avatarSeed} name={r.nickname} src={r.avatarUrl} size={30} />
                <span className="text-sm text-ink dark:text-dark-text">{r.nickname}</span>
                {r.mine && <span className="rounded bg-celadon-soft px-1.5 py-0.5 text-[10px] text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300">我的</span>}
                <Stars value={r.rating} size={12} className="ml-auto" />
              </div>
              {r.title && <p className="mt-2 text-sm font-medium text-ink dark:text-dark-text">{r.title}</p>}
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-700 dark:text-dark-text/85">{r.content}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-ink-300">
                <button
                  onClick={() => requireLogin(() => toggleLike(r.id))}
                  aria-pressed={isLiked}
                  className="flex items-center gap-1 active:scale-95"
                >
                  <motion.span key={isLiked ? "on" : "off"} initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}>
                    <Heart size={14} className={isLiked ? "fill-rouge text-rouge" : ""} />
                  </motion.span>
                  {formatCount(r.likes + (isLiked ? 1 : 0))}
                </button>
                <span>{formatDate(r.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 常驻「写书评」入口 */}
      <div className="app-width fixed bottom-0 left-1/2 z-30 -translate-x-1/2 border-t border-line bg-moon/95 p-3 pb-safe backdrop-blur dark:border-white/5 dark:bg-dark-bg/95">
        <button
          onClick={() => requireLogin(() => router.push(`/library/book/${id}/review/new`))}
          className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-celadon py-3 text-sm font-medium text-snow shadow-celadon active:scale-[0.99]"
        >
          <PenLine size={16} /> 写书评
        </button>
      </div>
    </main>
  );
}
