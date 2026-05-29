"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { Avatar } from "@/components/ui/Avatar";
import { Stars } from "@/components/ui/Stars";
import { Skeleton, EmptyState } from "@/components/ui/States";
import { getBookReviews } from "@/lib/api";
import { formatDate, formatCount } from "@/lib/utils";
import { useLibrary, requireLogin } from "@/lib/store";

export default function ReviewListPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [sort, setSort] = useState<"hot" | "new">("hot");
  const { data, isLoading } = useQuery({ queryKey: ["reviews", id, sort], queryFn: () => getBookReviews(id, sort) });
  const liked = useLibrary((s) => s.likedReviews);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const myReviews = useLibrary((s) => s.myReviews);

  const list = useMemo(() => {
    const mine = myReviews.filter((r) => r.bookId === id.split("__")[0]);
    const base = data ?? [];
    const merged = [...mine, ...base];
    if (sort === "hot") return [...merged].sort((a, b) => b.likes - a.likes);
    return [...merged].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
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
      <div className="space-y-3 p-4">
        {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {!isLoading && list.length === 0 && (
          <EmptyState icon="review" title="还没有书评" subtitle="成为第一个分享想法的人" actionText="写书评" actionHref={`/library/book/${id}/review/new`} />
        )}
        {list.map((r) => {
          const isLiked = liked.includes(r.id);
          return (
            <div key={r.id} className="animate-fade-up rounded-2xl bg-snow p-3.5 shadow-sm dark:bg-dark-card">
              <div className="flex items-center gap-2">
                <Avatar seed={r.avatarSeed} name={r.nickname} src={r.avatarUrl} size={30} />
                <span className="text-sm text-ink dark:text-dark-text">{r.nickname}</span>
                {r.mine && <span className="rounded bg-celadon-soft px-1.5 py-0.5 text-[10px] text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300">我的</span>}
                <Stars value={r.rating} size={12} className="ml-auto" />
              </div>
              {r.title && <p className="mt-2 text-sm font-medium text-ink dark:text-dark-text">{r.title}</p>}
              <p className="mt-1 text-sm leading-6 text-ink-700 dark:text-dark-text/85">{r.content}</p>
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
    </main>
  );
}
