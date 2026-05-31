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
import type { Book, Citation, ChatMessage as TMsg } from "@/lib/types";

function ChatInner() {
  const sp = useSearchParams();
  const sessions = useChat((s) => s.sessions);
  const [messages, setMessages] = useState<TMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false); // 同步闸门：拦住同一事件循环内的重复发送（busy state 异步、挡不住快速双击）
  const seq = useRef(0); // 单调自增，保证消息 id 不会同毫秒碰撞
  const pendingReply = useRef<{ id: string; citations: Citation[]; recommendations: Book[] } | null>(null);
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
    if (!q || busyRef.current) return;
    busyRef.current = true;
    setInput("");
    // 时间戳 + 自增计数器：跨会话/重开历史不撞（时间戳变），同毫秒快速连发也不撞（计数器变）
    const n = `${Date.now()}-${seq.current++}`;
    const userMsg: TMsg = { id: "u" + n, role: "user", content: q };
    const aId = "a" + n;
    const aMsg: TMsg = { id: aId, role: "assistant", content: "", streaming: true };
    setMessages((prev) => [...prev, userMsg, aMsg]);
    setBusy(true);

    const { answer, citations, recommendations } = buildChatReply(q);
    pendingReply.current = { id: aId, citations, recommendations }; // 暂存，停止生成时回写引用/推荐
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
        pendingReply.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    }, 16);
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    const pr = pendingReply.current;
    // 停止时也把已算好的引用/推荐回写到被中断的回答，保持与正常完成一致（否则正文里“点下方引用卡”会指向不存在的卡）
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.streaming) return m;
        if (pr && m.id === pr.id) return { ...m, citations: pr.citations, recommendations: pr.recommendations, streaming: false };
        return { ...m, streaming: false };
      })
    );
    pendingReply.current = null;
    busyRef.current = false;
    setBusy(false);
  }

  // 赞/踩写回消息并持久化，重开历史对话时可正确回显
  function setFeedback(id: string, v: "up" | "down" | null) {
    const next = messages.map((m) => (m.id === id ? { ...m, feedback: v ?? undefined } : m));
    setMessages(next);
    persist(next);
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
            <Mascot size={88} className="shadow-celadon" />
            <p className="mt-4 font-serif text-xl text-ink dark:text-dark-text">你的 AI 读书伙伴</p>
            <p className="mt-1 text-xs text-ink-300">通览馆藏，为你荐书 · 答疑 · 解读原文</p>
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
                onFeedback={(v) => setFeedback(m.id, v)}
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
