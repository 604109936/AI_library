"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { EmptyState } from "@/components/ui/States";
import { useLibrary, useUI } from "@/lib/store";
import { formatDate } from "@/lib/utils";

type Filter = "av" | "text";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "av", label: "音视频" },
  { key: "text", label: "文字稿" },
];
type Status = "all" | "reading" | "read";

function HistoryInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const history = useLibrary((s) => s.history);
  const removeHistory = useLibrary((s) => s.removeHistory);
  const toast = useUI((s) => s.toast);
  // 类型筛选（音视频/文字稿，默认音视频，页面内可平铺切换）
  const [filter, setFilter] = useState<Filter>("av");
  // 状态由入口决定（已读卡 / 进行中卡），页面内不提供状态切换
  const sParam = sp.get("status");
  const status: Status = sParam === "read" ? "read" : sParam === "reading" ? "reading" : "all";
  const title = status === "read" ? "已读" : status === "reading" ? "进行中" : "阅读历史";

  const list = history
    .filter((h) => (filter === "av" ? h.mode === "video" || h.mode === "audio" : h.mode === "text"))
    .filter((h) => (status === "all" ? true : status === "read" ? h.progress >= 100 : h.progress < 100));

  return (
    <main className="min-h-[100dvh]">
      <Header title={title} />
      <RequireAuth>
        <div className="flex gap-2 px-4 pt-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={"rounded-full px-3.5 py-1.5 text-xs transition " + (filter === f.key ? "bg-celadon text-snow" : "bg-snow text-ink-500 dark:bg-dark-card dark:text-dark-text/70")}
            >
              {f.label}
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <EmptyState
            icon="history"
            title={status === "read" ? "还没有读完的书" : status === "reading" ? "没有进行中的书" : filter === "av" ? "还没有音视频记录" : "还没有文字稿记录"}
            subtitle="去泡馆挑一本书读读吧"
            actionText="去泡馆逛逛"
            actionHref="/library"
          />
        ) : (
          <div className="space-y-3 p-4">
            {list.map((h) => {
              const done = h.progress >= 100;
              return (
                <div key={h.bookId + h.mode} className="flex items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm dark:bg-dark-card">
                  <BookCover title={h.bookTitle} seed={h.coverSeed} src={h.cover} className="w-12 shrink-0" showText={false} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-sm text-ink dark:text-dark-text">{h.bookTitle}</p>
                    {h.author && <p className="truncate text-[11px] text-ink-300">{h.author}</p>}
                    <div className="mt-1.5 flex items-center gap-2">
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

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-500">加载中…</div>}>
      <HistoryInner />
    </Suspense>
  );
}
