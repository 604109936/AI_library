"use client";
import { useRouter } from "next/navigation";
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
  const toast = useUI((s) => s.toast);

  return (
    <main className="min-h-[100dvh]">
      <Header
        title="阅读历史"
        right={
          history.length > 0 ? (
            <button onClick={() => { clearHistory(); toast("已清空"); }} className="text-xs text-ink-500">清空历史</button>
          ) : null
        }
      />
      <RequireAuth>
        {history.length === 0 ? (
          <EmptyState title="还没有阅读记录" subtitle="去泡馆挑一本书读读吧" actionText="去泡馆逛逛" actionHref="/library" />
        ) : (
          <div className="space-y-3 p-4">
            {history.map((h) => (
              <div key={h.bookId} className="flex items-center gap-3 rounded-xl bg-snow p-3 shadow-sm dark:bg-dark-card">
                <BookCover title={h.bookTitle} seed={h.coverSeed} className="w-12 shrink-0" showText={false} />
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-sm text-ink dark:text-dark-text">{h.bookTitle}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-300">
                    <span className="rounded bg-celadon-soft px-1.5 py-0.5 text-celadon-700">{MODE_LABEL[h.mode]}</span>
                    <span>{h.progress}%</span>
                    <span>·</span>
                    <span>{formatDate(h.lastAt)}</span>
                  </div>
                </div>
                <button
                  onClick={() => router.push(`/library/book/${h.bookId}/read`)}
                  className="rounded-full border border-celadon px-3 py-1.5 text-xs text-celadon-700 active:scale-95"
                >
                  继续阅读
                </button>
              </div>
            ))}
          </div>
        )}
      </RequireAuth>
    </main>
  );
}
