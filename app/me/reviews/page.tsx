"use client";
import { useRouter } from "next/navigation";
import { Trash2, ChevronRight } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { EmptyState } from "@/components/ui/States";
import { useLibrary, useUI } from "@/lib/store";
import { formatCount, formatDate } from "@/lib/utils";

export default function MyReviewsPage() {
  const router = useRouter();
  const myReviews = useLibrary((s) => s.myReviews);
  const removeReview = useLibrary((s) => s.removeReview);
  const toast = useUI((s) => s.toast);
  const list = [...myReviews].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <main className="min-h-[100dvh]">
      <Header title="我的书评" />
      <RequireAuth>
        {list.length === 0 ? (
          <EmptyState title="还没有写过书评" subtitle="读完一本书，写下你的想法吧" actionText="去泡馆逛逛" actionHref="/library" />
        ) : (
          <div className="space-y-3 p-4">
            {list.map((r) => (
              <div key={r.id} className="rounded-xl bg-snow p-3.5 shadow-sm dark:bg-dark-card">
                <button onClick={() => router.push(`/library/book/${r.bookId}/reviews`)} className="flex w-full gap-3 text-left">
                  <BookCover title={r.bookTitle ?? ""} seed={r.bookCoverSeed ?? 1} className="w-12 shrink-0" showText={false} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-serif text-sm text-ink dark:text-dark-text">{r.bookTitle}</span>
                      <ChevronRight size={14} className="text-ink-300" />
                    </div>
                    <Stars value={r.rating} size={12} className="mt-1" />
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">{r.content}</p>
                  </div>
                </button>
                <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[11px] text-ink-300">
                  <span>♥ {formatCount(r.likes)} · {formatDate(r.createdAt)}</span>
                  <button onClick={() => { removeReview(r.id); toast("已删除"); }} className="flex items-center gap-1 active:text-rouge">
                    <Trash2 size={13} /> 删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </RequireAuth>
    </main>
  );
}
