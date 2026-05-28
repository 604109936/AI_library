"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MessageCircle, Trash2, ChevronRight } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { EmptyState } from "@/components/ui/States";
import { useChat, useUI } from "@/lib/store";
import { sampleSessions } from "@/lib/mock/data";
import { formatDate } from "@/lib/utils";

export default function ChatHistory() {
  const router = useRouter();
  const sessions = useChat((s) => s.sessions);
  const removeSession = useChat((s) => s.removeSession);
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const real = sessions.map((s) => ({ ...s, real: true }));
    const sampleIds = new Set(real.map((r) => r.title));
    const samples = sampleSessions
      .filter((s) => !sampleIds.has(s.title))
      .map((s) => ({ ...s, real: false }));
    const all = [...real, ...samples];
    if (!q.trim()) return all;
    return all.filter((s) => s.title.includes(q.trim()));
  }, [sessions, q]);

  return (
    <main className="min-h-[100dvh]">
      <Header title="历史对话" />
      <div className="px-4">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-snow px-3.5 py-2.5 dark:bg-dark-card">
          <Search size={16} className="text-ink-300" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索历史对话"
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-300"
          />
        </div>

        {list.length === 0 ? (
          <EmptyState title="还没有对话记录" subtitle="去智学问点什么吧" actionText="去智学" actionHref="/chat" />
        ) : (
          <div className="mt-3 space-y-2.5">
            {list.map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-3 rounded-lg bg-snow p-3.5 shadow-sm dark:bg-dark-card"
              >
                <button
                  onClick={() => router.push(s.real ? `/chat?s=${s.id}` : "/chat")}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-celadon-soft">
                    <MessageCircle size={16} className="text-celadon-700" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink dark:text-dark-text">{s.title}</p>
                    <p className="text-[11px] text-ink-300">{formatDate(s.updatedAt)}</p>
                  </div>
                </button>
                {s.real ? (
                  <button
                    onClick={() => { removeSession(s.id); toast("已删除"); }}
                    className="text-ink-300 active:text-rouge"
                  >
                    <Trash2 size={16} />
                  </button>
                ) : (
                  <ChevronRight size={16} className="text-ink-300" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
