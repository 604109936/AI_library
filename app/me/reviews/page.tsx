"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2, Pencil } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { EmptyState } from "@/components/ui/States";
import { useLibrary, useUI } from "@/lib/store";
import { books } from "@/lib/mock/data";
import { formatDate } from "@/lib/utils";

export default function MyReviewsPage() {
  const router = useRouter();
  const myReviews = useLibrary((s) => s.myReviews);
  const removeReview = useLibrary((s) => s.removeReview);
  const toast = useUI((s) => s.toast);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const list = [...myReviews].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  function doRemove() {
    if (!confirmId) return;
    removeReview(confirmId);
    setConfirmId(null);
    toast("已删除");
  }

  return (
    <main className="min-h-[100dvh]">
      <Header title="我的书评" />
      <RequireAuth>
        {list.length === 0 ? (
          <EmptyState icon="review" title="还没有写过书评" subtitle="读完一本书，写下你的想法吧" actionText="去泡馆逛逛" actionHref="/library" />
        ) : (
          <div className="space-y-3 p-4">
            {list.map((r) => {
              // 标题/封面统一以 books 为准（单一数据源），降级到创建时快照
              const book = books.find((b) => b.id === r.bookId);
              const title = book?.title ?? r.bookTitle ?? "";
              return (
                <div key={r.id} className="rounded-2xl bg-snow p-3.5 shadow-sm dark:bg-dark-card">
                  {/* 本版「读者评价」只存数据、不前端展示：卡片仅展示我的书评，不可点进入读者评价列表 */}
                  <div className="flex w-full gap-3 text-left">
                    <BookCover title={title} seed={book?.coverSeed ?? r.bookCoverSeed ?? 1} src={book?.cover ?? r.bookCover} className="w-12 shrink-0" showText={false} />
                    <div className="min-w-0 flex-1">
                      {/* 书名行：书名居左、星级居右 */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-serif text-sm text-ink dark:text-dark-text">{title}</span>
                        <Stars value={r.rating} size={12} className="shrink-0" />
                      </div>
                      {r.title && <p className="mt-1 text-xs font-medium text-ink dark:text-dark-text">{r.title}</p>}
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500 dark:text-dark-text/60">{r.content}</p>
                    </div>
                  </div>
                  {/* 不显示点赞数；支持单条编辑与删除（删除需二次确认） */}
                  <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-[11px] text-ink-300 dark:border-white/5">
                    <span>{formatDate(r.createdAt)}</span>
                    <div className="flex items-center gap-4">
                      <button onClick={() => router.push(`/library/book/${r.bookId}/review/new`)} className="flex items-center gap-1 text-celadon-700 active:scale-95 dark:text-celadon-300">
                        <Pencil size={13} /> 编辑
                      </button>
                      <button aria-label="删除书评" onClick={() => setConfirmId(r.id)} className="flex items-center gap-1 active:text-rouge">
                        <Trash2 size={13} /> 删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </RequireAuth>

      {/* 删除二次确认 */}
      <AnimatePresence>
        {confirmId && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setConfirmId(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 32 }} className="app-width relative rounded-t-[24px] bg-snow p-5 pb-safe dark:bg-dark-card">
              <p className="text-center text-sm text-ink dark:text-dark-text">确认删除这条书评？</p>
              <p className="mt-1 text-center text-xs text-ink-300">删除后不可恢复</p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => setConfirmId(null)} className="flex-1 rounded-2xl bg-moon py-3 text-sm text-ink-700 dark:bg-dark-bg dark:text-dark-text/80">取消</button>
                <button onClick={doRemove} className="flex-1 rounded-2xl bg-rouge py-3 text-sm text-snow">删除</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
