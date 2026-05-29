"use client";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { EmptyState } from "@/components/ui/States";
import { useLibrary, useUI } from "@/lib/store";
import { formatDate } from "@/lib/utils";
import type { ReadingMode } from "@/lib/types";

const MODE_LABEL: Record<ReadingMode, string> = { video: "视频", audio: "音频", text: "文字" };

export default function HistoryPage() {
  const router = useRouter();
  const history = useLibrary((s) => s.history);
  const clearHistory = useLibrary((s) => s.clearHistory);
  const removeHistory = useLibrary((s) => s.removeHistory);
  const toast = useUI((s) => s.toast);

  return (
    <main className="min-h-[100dvh]">
      <Header
        title="阅读历史"
        right={
          history.length > 0 ? (
            <button onClick={() => { clearHistory(); toast("已清空"); }} className="text-xs text-ink-500 dark:text-dark-text/60">清空历史</button>
          ) : undefined
        }
      />
      <RequireAuth>
        {history.length === 0 ? (
          <EmptyState icon="history" title="还没有阅读记录" subtitle="去泡馆挑一本书读读吧" actionText="去泡馆逛逛" actionHref="/library" />
        ) : (
          <div className="space-y-3 p-4">
            {history.map((h, i) => {
              const done = h.progress >= 100;
              return (
                <div key={h.bookId} className="flex animate-fade-up items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm dark:bg-dark-card" style={{ animationDelay: `${i * 0.04}s` }}>
                  <BookCover title={h.bookTitle} seed={h.coverSeed} src={h.cover} className="w-12 shrink-0" showText={false} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-sm text-ink dark:text-dark-text">{h.bookTitle}</p>
                    {h.author && <p className="truncate text-[11px] text-ink-300">{h.author}</p>}
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="rounded bg-celadon-soft px-1.5 py-0.5 text-[10px] text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300">{MODE_LABEL[h.mode]}</span>
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-line dark:bg-white/10">
                        <div className="h-full rounded-full bg-celadon" style={{ width: `${h.progress}%` }} />
                      </div>
                      <span className="text-[10px] text-ink-300">{done ? "已读完" : `${h.progress}%`}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-300">{formatDate(h.lastAt)}</p>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <button aria-label="删除记录" onClick={() => { removeHistory(h.bookId); toast("已移除"); }} className="text-ink-300 active:text-rouge">
                      <X size={16} />
                    </button>
                    <button
                      onClick={() => router.push(h.mode === "text" ? `/library/book/${h.bookId}/read` : `/library/book/${h.bookId}`)}
                      className="rounded-full border border-celadon px-3 py-1.5 text-xs text-celadon-700 active:scale-95 dark:text-celadon-300"
                    >
                      {done ? "重读" : "继续"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </RequireAuth>
    </main>
  );
}
