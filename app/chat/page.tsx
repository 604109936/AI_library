"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, History, Send, Square, Sparkles } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { Mascot } from "@/components/chat/Mascot";
import { Motif } from "@/components/ui/Motif";
import { buildChatReply, exampleQuestions } from "@/lib/api";
import { sampleSessions } from "@/lib/mock/data";
import { useChat } from "@/lib/store";
import type { ChatMessage as TMsg } from "@/lib/types";

function ChatInner() {
  const sp = useSearchParams();
  const sessions = useChat((s) => s.sessions);
  const [messages, setMessages] = useState<TMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const upsertSession = useChat((s) => s.upsertSession);
  const sessionId = useRef<string>("sess-" + Date.now());

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // 从历史打开指定会话
  useEffect(() => {
    const sid = sp.get("s");
    if (!sid) return;
    const found = sessions.find((x) => x.id === sid) ?? sampleSessions.find((x) => x.id === sid);
    if (found && found.messages.length) {
      sessionId.current = found.id;
      setMessages(found.messages);
    }
    // eslint-disable-next-line
  }, [sp]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // 生成结束/停止后持久化会话到历史（避免在渲染更新函数里调用 store setter）
  useEffect(() => {
    if (!busy && messages.length) persist(messages);
    // eslint-disable-next-line
  }, [busy]);

  function persist(msgs: TMsg[]) {
    const firstUser = msgs.find((m) => m.role === "user");
    if (!firstUser) return;
    upsertSession({
      id: sessionId.current,
      title: firstUser.content.slice(0, 20),
      updatedAt: new Date().toISOString(),
      messages: msgs,
    });
  }

  function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const userMsg: TMsg = { id: "u" + Date.now(), role: "user", content: q };
    const aId = "a" + Date.now();
    const aMsg: TMsg = { id: aId, role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, userMsg, aMsg]);
    setBusy(true);

    const { answer, citations, recommendations } = buildChatReply(q);
    let i = 0;
    timer.current = setInterval(() => {
      i += 2;
      const partial = answer.slice(0, i);
      setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: partial } : m)));
      if (i >= answer.length) {
        if (timer.current) clearInterval(timer.current);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aId ? { ...m, content: answer, citations, recommendations, streaming: false } : m
          )
        );
        setBusy(false);
      }
    }, 16);
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    setBusy(false);
  }

  function regenerate() {
    if (busy) return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const q = messages[lastUserIdx].content;
    // 去掉最后一轮的"用户提问 + 回答"，再重新发送，避免重复用户气泡
    setMessages((prev) => prev.slice(0, lastUserIdx));
    setTimeout(() => send(q), 30);
  }

  function newSession() {
    if (busy) return;
    setMessages([]);
    sessionId.current = "sess-" + Date.now();
  }

  const empty = messages.length === 0;

  return (
    <main className="min-h-[100dvh] pb-[150px]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-moon/90 px-3 backdrop-blur dark:bg-dark-bg/90">
        <Link href="/chat/history" className="flex h-9 w-9 items-center justify-center rounded-full active:bg-line/50">
          <History size={20} className="text-ink-700 dark:text-dark-text" />
        </Link>
        <span className="font-serif text-lg text-ink dark:text-dark-text">智学</span>
        <button onClick={newSession} className="flex h-9 w-9 items-center justify-center rounded-full active:bg-line/50">
          <Plus size={22} className="text-ink-700 dark:text-dark-text" />
        </button>
      </header>

      <div className="px-4">
        {empty ? (
          <div className="relative flex flex-col items-center pt-10">
            <Motif name="bamboo" className="pointer-events-none absolute -top-2 right-0 h-20 w-20 text-celadon/30" />
            <Mascot size={84} className="shadow-celadon" />
            <h1 className="mt-4 font-serif text-2xl text-ink dark:text-dark-text">智学</h1>
            <p className="mt-1.5 text-sm text-ink-700 dark:text-dark-text/80">你的 AI 读书伙伴</p>
            <p className="mt-0.5 text-xs text-ink-300">通览馆藏，为你荐书 · 答疑 · 解读原文</p>
            <div className="mt-6 w-full space-y-2.5">
              {exampleQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="flex w-full items-center gap-2 rounded-xl bg-snow px-4 py-3 text-left text-sm text-ink-700 shadow-sm active:scale-[0.99] dark:bg-dark-card dark:text-dark-text"
                >
                  <Sparkles size={14} className="shrink-0 text-celadon" />
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-3">
            {messages.map((m, i) => (
              <ChatMessage
                key={m.id}
                msg={m}
                onRegenerate={!busy && m.role === "assistant" && i === messages.length - 1 ? regenerate : undefined}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* 输入区：固定在底栏上方 */}
      <div className="app-width fixed bottom-[58px] left-1/2 z-40 -translate-x-1/2 border-t border-line bg-moon/95 px-3 py-2.5 backdrop-blur dark:border-white/5 dark:bg-dark-bg/95">
        {busy && (
          <button onClick={stop} className="mx-auto mb-2 flex items-center gap-1 rounded-full border border-line bg-snow px-3 py-1 text-xs text-ink-500 dark:bg-dark-card">
            <Square size={12} /> 停止生成
          </button>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="想读点什么？问问智学吧"
            className="max-h-24 flex-1 resize-none rounded-2xl border border-line bg-snow px-4 py-2.5 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text dark:placeholder:text-dark-text/40"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || busy}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-celadon text-snow disabled:opacity-40 active:scale-95"
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      <BottomNav active="chat" />
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-500">加载中…</div>}>
      <ChatInner />
    </Suspense>
  );
}
