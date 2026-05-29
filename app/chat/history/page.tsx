"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, MessageCircle, Trash2 } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { EmptyState } from "@/components/ui/States";
import { Motif } from "@/components/ui/Motif";
import { useChat, useUI } from "@/lib/store";
import { sampleSessions } from "@/lib/mock/data";
import { formatChatTime } from "@/lib/utils";
import type { ChatSession } from "@/lib/types";

function preview(s: ChatSession): string {
  const a = [...s.messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
  const u = [...s.messages].reverse().find((m) => m.role === "user" && m.content.trim());
  const text = (a ?? u)?.content ?? "";
  return text.replace(/\n+/g, " ").replace(/[#*>`]/g, "").trim().slice(0, 28);
}

export default function ChatHistory() {
  const router = useRouter();
  const sessions = useChat((s) => s.sessions);
  const removeSession = useChat((s) => s.removeSession);
  const clearSessions = useChat((s) => s.clearSessions);
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<{ type: "one"; id: string } | { type: "all" } | null>(null);

  const hasReal = sessions.length > 0;

  const all = useMemo(() => {
    const realIds = new Set(sessions.map((s) => s.id));
    const merged = [
      ...sessions.map((s) => ({ ...s, real: true })),
      ...sampleSessions.filter((s) => !realIds.has(s.id)).map((s) => ({ ...s, real: false })),
    ];
    return merged.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  }, [sessions]);

  const kw = q.trim();
  const list = kw
    ? all.filter((s) => s.title.includes(kw) || s.messages.some((m) => m.content.includes(kw)))
    : all;

  return (
    <main className="min-h-[100dvh]">
      <Header
        title="历史对话"
        right={
          hasReal ? (
            <button onClick={() => setConfirm({ type: "all" })} className="text-xs text-ink-500 dark:text-dark-text/60">清空</button>
          ) : undefined
        }
      />
      <div className="px-4">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-snow px-3.5 py-2.5 dark:border-white/10 dark:bg-dark-card">
          <Search size={16} className="text-ink-300" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜索历史对话"
            placeholder="搜索对话或内容"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text"
          />
        </div>

        {all.length === 0 ? (
          <EmptyState title="还没有对话记录" subtitle="去智学问点什么吧" actionText="去智学" actionHref="/chat" />
        ) : list.length === 0 ? (
          <EmptyState icon="search" title="没有找到相关对话" subtitle="换个关键词试试" actionText="清除搜索" onAction={() => setQ("")} />
        ) : (
          <div className="mt-3 space-y-2.5">
            {list.map((s, i) => (
              <div
                key={s.id}
                className="group flex animate-fade-up items-center gap-3 rounded-2xl bg-snow p-3.5 shadow-sm dark:bg-dark-card"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <button
                  onClick={() => router.push(`/chat?s=${s.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-celadon-soft dark:bg-celadon/20">
                    <MessageCircle size={16} className="text-celadon-700 dark:text-celadon-300" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-ink dark:text-dark-text">{s.title}</p>
                      <span className="shrink-0 text-[11px] text-ink-300">{formatChatTime(s.updatedAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-300">{preview(s) || "（示例对话）"}</p>
                  </div>
                </button>
                {s.real && (
                  <button
                    aria-label={`删除对话 ${s.title}`}
                    onClick={() => setConfirm({ type: "one", id: s.id })}
                    className="p-1 text-ink-300 active:text-rouge"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <Motif name="mountain" className="mx-auto mt-8 h-12 w-40 text-celadon/25" />
      </div>

      {/* 二次确认 */}
      <AnimatePresence>
        {confirm && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setConfirm(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 dark:bg-dark-card">
              <p className="text-center text-sm text-ink dark:text-dark-text">
                {confirm.type === "all" ? "确认清空全部对话记录？" : "确认删除这条对话？"}
              </p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => setConfirm(null)} className="flex-1 rounded-2xl bg-moon py-3 text-sm text-ink-700 dark:bg-dark-bg dark:text-dark-text/80">取消</button>
                <button
                  onClick={() => {
                    if (confirm.type === "all") { clearSessions(); toast("已清空"); }
                    else { removeSession(confirm.id); toast("已删除"); }
                    setConfirm(null);
                  }}
                  className="flex-1 rounded-2xl bg-rouge py-3 text-sm text-snow"
                >
                  {confirm.type === "all" ? "清空" : "删除"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
