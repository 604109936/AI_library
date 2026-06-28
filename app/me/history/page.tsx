"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X, ChevronRight } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { EmptyState } from "@/components/ui/States";
import { useLibrary, useUI } from "@/lib/store";
import { formatDate } from "@/lib/utils";
import type { HistoryItem } from "@/lib/types";

type Filter = "all" | "av" | "text";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
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
  // 类型筛选（全部/音视频/文字稿，页面内可平铺切换）。从「我的」统计卡进入不带 mode → 落「全部」视图：
  // 卡片的「已读/进行中」是跨音视频+文字稿按书去重的并集计数，只有「全部」视图（同样按书去重）条数才与之一致。
  const [filter, setFilter] = useState<Filter>(() => { const m = sp.get("mode"); return m === "text" ? "text" : m === "av" ? "av" : "all"; });
  // 状态由入口决定（已读卡 / 进行中卡），页面内不提供状态切换
  const sParam = sp.get("status");
  const status: Status = sParam === "read" ? "read" : sParam === "reading" ? "reading" : "all";
  const title = status === "read" ? "已读" : status === "reading" ? "进行中" : "阅读历史";

  // 列表 = 按「音视频/文字稿」大类筛选 + 状态过滤，按 lastAt 倒序（撤销恢复的旧记录不被错误置顶 Bug#15）。
  // 同一本书在每个大类下最多一条记录（store 按「书+大类」去重），故筛选后天然不会同书重复。
  // 进行中排除 0%（0% 是「打开过没读」= 未读，不算进行中）；已读 = 进度≥100；阅读历史(all) = 全部。
  const byLastDesc = (a: HistoryItem, b: HistoryItem) => +new Date(b.lastAt) - +new Date(a.lastAt);
  const matchMode = (h: HistoryItem) => (filter === "all" ? true : filter === "av" ? h.mode === "video" || h.mode === "audio" : h.mode === "text");
  const matchStatus = (h: HistoryItem) => (status === "read" ? h.progress >= 100 : status === "reading" ? h.progress > 0 && h.progress < 100 : true);
  let list = history.filter(matchMode).filter(matchStatus).sort(byLastDesc);
  // 「全部」视图按 bookId 去重（已先按状态过滤、再按 lastAt 倒序，保留最新一条）：条数 == 「我的」统计卡的跨模式去重计数
  if (filter === "all") {
    const seen = new Set<string>();
    list = list.filter((h) => (seen.has(h.bookId) ? false : (seen.add(h.bookId), true)));
  }

  return (
    <main className="min-h-[100dvh]">
      <Header title={title} />
      <RequireAuth>
        {/* 音视频/文字稿 筛选：已读/进行中/阅读历史 三个视图都展示，默认音视频 */}
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
            title={(() => {
              const m = filter === "all" ? "" : filter === "av" ? "音视频" : "文字稿";
              if (status === "read") return m ? `没有${m}的已读记录` : "还没有已读完的书";
              if (status === "reading") return m ? `没有进行中的${m}` : "没有进行中的书";
              return m ? `还没有${m}记录` : "还没有阅读记录";
            })()}
            subtitle="去泡馆挑一本书读读吧"
            actionText="去泡馆逛逛"
            actionHref="/library"
          />
        ) : (
          <div className="space-y-3 p-4">
            {list.map((h) => {
              const done = h.progress >= 100;
              const detailHref = `/library/book/${h.bookId}`;
              return (
                // 整卡可点 → 书详情页：已读完不再"重读"进阅读器、进行中也统一进详情（用户口径）
                <div key={h.bookId + h.mode} onClick={() => router.push(detailHref)} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm transition active:scale-[0.99] dark:bg-dark-card">
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
                    {/* 删除按钮 stopPropagation：单击即删给 4s 撤销窗口，且不触发整卡跳转 */}
                    <button aria-label="删除记录" onClick={(e) => { e.stopPropagation(); const snap = h; removeHistory(h.bookId, h.mode); toast("已移除", "success", { label: "撤销", onClick: () => pushHistory(snap) }); }} className="-m-3.5 p-3.5 text-ink-300 active:text-rouge">
                      <X size={16} />
                    </button>
                    {done ? (
                      // 已读完：不支持重读，仅用箭头提示"点击进详情"（整卡可点）
                      <ChevronRight size={18} className="text-ink-300" />
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(detailHref); }}
                        className="rounded-full border border-celadon px-3 py-1.5 text-xs text-celadon-700 active:scale-95 dark:text-celadon-300"
                      >
                        继续
                      </button>
                    )}
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
