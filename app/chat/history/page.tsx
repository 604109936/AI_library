"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, MessageCircle, Trash2, CornerDownRight } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { EmptyState } from "@/components/ui/States";
import { Motif } from "@/components/ui/Motif";
import { useChat, useUI } from "@/lib/store";
import { formatChatTime } from "@/lib/utils";
import type { ChatSession } from "@/lib/types";

function preview(s: ChatSession): string {
  const a = [...s.messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
  const u = [...s.messages].reverse().find((m) => m.role === "user" && m.content.trim());
  const text = (a ?? u)?.content ?? "";
  return text.replace(/\n+/g, " ").replace(/[#*>`]/g, "").trim().slice(0, 28);
}

// 以搜索词为中心截取消息片段
function snippetAround(content: string, kw: string): string {
  const c = content.replace(/\s+/g, " ").replace(/[#*>`]/g, "").trim();
  const i = c.indexOf(kw);
  if (i < 0) return c.slice(0, 30);
  const start = Math.max(0, i - 6);
  return (start > 0 ? "…" : "") + c.slice(start, i + kw.length + 20);
}

// 高亮命中的搜索词
function highlight(text: string, kw: string) {
  if (!kw) return text;
  const parts = text.split(kw);
  return parts.map((p, i) =>
    i < parts.length - 1 ? (
      <span key={i}>{p}<span className="font-semibold text-celadon-700 dark:text-celadon-300">{kw}</span></span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export default function ChatHistory() {
  const router = useRouter();
  const sessions = useChat((s) => s.sessions);
  const removeSession = useChat((s) => s.removeSession);
  const clearSessions = useChat((s) => s.clearSessions);
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<{ type: "one"; id: string } | { type: "all" } | null>(null);

  // 只展示真实会话：以前合并的示例假对话会冒充"你问过的问题"，直接打脸"这座图书馆认识我"
  const all = useMemo(() => [...sessions].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)), [sessions]);

  const kw = q.trim();

  // 搜索态：每条命中搜索词的消息展开为一个条目；仅标题命中的会话单独成一条
  const hits = useMemo(() => {
    if (!kw) return [] as { key: string; sid: string; title: string; updatedAt: string; msgId: string | null; text: string }[];
    const arr: { key: string; sid: string; title: string; updatedAt: string; msgId: string | null; text: string }[] = [];
    for (const s of all) {
      const msgHits = s.messages.filter((m) => m.content.includes(kw));
      if (msgHits.length) {
        for (const m of msgHits) {
          arr.push({ key: s.id + ":" + m.id, sid: s.id, title: s.title, updatedAt: s.updatedAt, msgId: m.id, text: snippetAround(m.content, kw) });
        }
      } else if (s.title.includes(kw)) {
        arr.push({ key: s.id, sid: s.id, title: s.title, updatedAt: s.updatedAt, msgId: null, text: preview(s) });
      }
    }
    return arr;
  }, [all, kw]);

  function openHit(sid: string, msgId: string | null) {
    const params = new URLSearchParams({ s: sid, q: kw });
    if (msgId) params.set("mid", msgId);
    router.push(`/chat?${params.toString()}`);
  }

  function doConfirm() {
    if (!confirm) return;
    if (confirm.type === "all") {
      clearSessions();
      toast("已清空");
    } else {
      removeSession(confirm.id);
      toast("已删除");
    }
    setConfirm(null);
  }

  return (
    <main className="min-h-[100dvh]">
      <Header
        title="历史对话"
        right={
          !kw && all.length > 0 ? (
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
          <EmptyState title="小涤还在等你的第一个问题" subtitle="读书路上的疑惑，都可以问我" actionText="去聊聊" actionHref="/chat" />
        ) : kw ? (
          // 搜索态：命中条目列表（每条命中一项，点击唯一跳转到该条）
          hits.length === 0 ? (
            <EmptyState icon="search" title="没有找到相关对话" subtitle="换个关键词试试" actionText="清除搜索" onAction={() => setQ("")} />
          ) : (
            <div className="mt-3 space-y-2.5">
              <p className="px-1 text-[11px] text-ink-300">共 {hits.length} 处匹配</p>
              {hits.map((h) => (
                <button
                  key={h.key}
                  onClick={() => openHit(h.sid, h.msgId)}
                  className="flex w-full items-start gap-3 rounded-2xl bg-snow p-3.5 text-left shadow-sm transition active:scale-[0.99] dark:bg-dark-card"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-celadon-soft dark:bg-celadon/20">
                    {h.msgId ? <CornerDownRight size={15} className="text-celadon-700 dark:text-celadon-300" /> : <MessageCircle size={16} className="text-celadon-700 dark:text-celadon-300" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-ink dark:text-dark-text">{h.title.includes(kw) ? highlight(h.title, kw) : h.title}</p>
                      <span className="shrink-0 text-[11px] text-ink-300">{formatChatTime(h.updatedAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-300">{highlight(h.text, kw)}</p>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : (
          // 默认：会话列表（可删除）
          <div className="mt-3 space-y-2.5">
            {all.map((s) => (
              <div key={s.id} className="group flex items-center gap-3 rounded-2xl bg-snow p-3.5 shadow-sm dark:bg-dark-card">
                <button onClick={() => router.push(`/chat?s=${s.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-celadon-soft dark:bg-celadon/20">
                    <MessageCircle size={16} className="text-celadon-700 dark:text-celadon-300" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-ink dark:text-dark-text">{s.title}</p>
                      <span className="shrink-0 text-[11px] text-ink-300">{formatChatTime(s.updatedAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-300">{preview(s)}</p>
                  </div>
                </button>
                <button
                  aria-label={`删除对话 ${s.title}`}
                  onClick={() => setConfirm({ type: "one", id: s.id })}
                  className="-m-1 flex h-10 w-10 items-center justify-center text-ink-300 active:text-rouge"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        <Motif name="mountain" className="mx-auto mt-8 h-12 w-40 text-celadon/25" />
      </div>

      <AnimatePresence>
        {confirm && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setConfirm(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] dark:bg-dark-card">
              <p className="text-center text-sm text-ink dark:text-dark-text">
                {confirm.type === "all" ? "确认清空全部对话记录？" : "确认删除这条对话？"}
              </p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => setConfirm(null)} className="flex-1 rounded-2xl bg-moon py-3 text-sm text-ink-700 dark:bg-dark-bg dark:text-dark-text/80">取消</button>
                <button onClick={doConfirm} className="flex-1 rounded-2xl bg-rouge py-3 text-sm text-snow">
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
