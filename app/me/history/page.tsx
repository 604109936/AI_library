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
import type { HistoryItem } from "@/lib/types";

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
  const pushHistory = useLibrary((s) => s.pushHistory);
  const toast = useUI((s) => s.toast);
  // 类型筛选（音视频/文字稿，页面内可平铺切换）；入口可经 ?mode= 指定默认值（数据卡按"有记录的大类"传入）
  const [filter, setFilter] = useState<Filter>(() => (sp.get("mode") === "text" ? "text" : "av"));
  // 状态由入口决定（已读卡 / 进行中卡），页面内不提供状态切换
  const sParam = sp.get("status");
  const status: Status = sParam === "read" ? "read" : sParam === "reading" ? "reading" : "all";
  const title = status === "read" ? "已读" : status === "reading" ? "进行中" : "阅读历史";

  // 「已读/进行中」由数据卡进入：卡片数字跨大类按「书」去重统计，故列表也按书去重展示全部大类，
  // 使卡片数字与列表条数严格一致（Bug#19）；纯「阅读历史」(status=all)仍按 av/text 平铺切换。
  // 两种视图均按 lastAt 倒序，使撤销删除恢复的旧记录不被错误置顶（Bug#15）。
  const byLastDesc = (a: HistoryItem, b: HistoryItem) => +new Date(b.lastAt) - +new Date(a.lastAt);
  let list: HistoryItem[];
  if (status === "all") {
    list = history
      .filter((h) => (filter === "av" ? h.mode === "video" || h.mode === "audio" : h.mode === "text"))
      .sort(byLastDesc);
  } else {
    const m = new Map<string, HistoryItem>();
    for (const h of history.filter((h) => (status === "read" ? h.progress >= 100 : h.progress < 100))) {
      const cur = m.get(h.bookId);
      if (!cur || h.progress > cur.progress) m.set(h.bookId, h); // 同书跨大类去重，保留进度更高的一条
    }
    list = Array.from(m.values()).sort(byLastDesc);
  }

  return (
    <main className="min-h-[100dvh]">
      <Header title={title} />
      <RequireAuth>
        {/* av/text 切换仅在纯「阅读历史」(status=all)展示；「已读/进行中」按书去重跨大类合并，无需切换（Bug#19） */}
        {status === "all" && (
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
        )}
        {list.length === 0 ? (
          <EmptyState
            icon="history"
            title={status === "read" ? "读完的第一本书，会在这里亮相" : status === "reading" ? "没有进行中的书" : filter === "av" ? "还没有音视频记录" : "还没有文字稿记录"}
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
                    {/* 单击即删给 4s 撤销窗口（与收藏/笔记删除同口径），误触不再不可挽回 */}
                    <button aria-label="删除记录" onClick={() => { const snap = h; removeHistory(h.bookId, h.mode); toast("已移除", "success", { label: "撤销", onClick: () => pushHistory(snap) }); }} className="-m-3.5 p-3.5 text-ink-300 active:text-rouge">
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
    <Suspense fallback={<div className="p-8 text-center text-ink-500">正在打开</div>}>
      <HistoryInner />
    </Suspense>
  );
}
