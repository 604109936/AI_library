"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, History, Send, Square, Sparkles, Mic, X } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { Mascot } from "@/components/chat/Mascot";
import { Motif } from "@/components/ui/Motif";
import { exampleQuestions } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import { sampleSessions } from "@/lib/mock/data";
import { useChat, useUI } from "@/lib/store";
import type { Book, Citation, ChatMessage as TMsg } from "@/lib/types";

type Locate = { type: "end" } | { type: "q"; q: string } | { type: "id"; id: string };

function ChatInner() {
  const sp = useSearchParams();
  const sessions = useChat((s) => s.sessions);
  const toast = useUI((s) => s.toast);
  const [messages, setMessages] = useState<TMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const cancelArmedRef = useRef(false);
  const [locatedId, setLocatedId] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const seq = useRef(0);
  const pendingReply = useRef<{ id: string; citations: Citation[]; recommendations: Book[] } | null>(null);
  const fetchCtrl = useRef<AbortController | null>(null);
  const pendingLocate = useRef<Locate | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const upsertSession = useChat((s) => s.upsertSession);
  const sessionId = useRef<string>("sess-" + Date.now());

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    fetchCtrl.current?.abort(); // 离开页面终止在途请求
  }, []);

  // 从历史打开指定会话：记录定位意图（无搜索→到最后；有搜索→命中处的最后一条）
  useEffect(() => {
    const sid = sp.get("s");
    if (!sid) return;
    const qparam = sp.get("q") ?? "";
    const mid = sp.get("mid") ?? "";
    const found = sessions.find((x) => x.id === sid) ?? sampleSessions.find((x) => x.id === sid);
    if (found && found.messages.length) {
      sessionId.current = found.id;
      setMessages(found.messages);
      pendingLocate.current = mid ? { type: "id", id: mid } : qparam ? { type: "q", q: qparam } : { type: "end" };
    }
    // eslint-disable-next-line
  }, [sp]);

  // 统一滚动：从历史进入按意图瞬时定位；发消息/流式时跟随到底（无平滑动画，避免多余滑动）
  useEffect(() => {
    const pl = pendingLocate.current;
    if (pl) {
      if (messages.length === 0) return; // 会话内容尚未填充，待填充后再定位（修复：空消息时被提前消费只会滚到底部）
      pendingLocate.current = null;
      requestAnimationFrame(() => {
        let targetId: string | null = null;
        if (pl.type === "id") {
          if (messages.some((m) => m.id === pl.id)) targetId = pl.id;
        } else if (pl.type === "q") {
          targetId = [...messages].reverse().find((m) => m.content.includes(pl.q))?.id ?? null;
        }
        if (targetId) {
          const el = document.getElementById("msg-" + targetId);
          if (el) {
            el.scrollIntoView({ block: "center", behavior: "auto" });
            setLocatedId(targetId);
            setTimeout(() => setLocatedId(null), 2200);
            return;
          }
        }
        bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
      });
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [messages]);

  useEffect(() => {
    if (!busy && messages.length) persist(messages);
    // eslint-disable-next-line
  }, [busy]);

  function persist(msgs: TMsg[]) {
    const firstUser = msgs.find((m) => m.role === "user");
    if (!firstUser) return;
    upsertSession({ id: sessionId.current, title: firstUser.content.slice(0, 20), updatedAt: new Date().toISOString(), messages: msgs });
  }

  // T2.1：答案来源 = 云函数 /api/chat（MiniMax 真实大模型，带多轮上下文）；
  // 拿到完整回答后仍用打字机渐显（T2.4 升级为 SSE 真流式）。
  function send(text: string) {
    const q = text.trim();
    if (!q || busyRef.current) return;
    busyRef.current = true;
    setInput("");
    const n = `${Date.now()}-${seq.current++}`;
    const userMsg: TMsg = { id: "u" + n, role: "user", content: q };
    const aId = "a" + n;
    const aMsg: TMsg = { id: aId, role: "assistant", content: "", streaming: true };
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg, aMsg]);
    setBusy(true);

    const ctrl = new AbortController();
    fetchCtrl.current = ctrl;
    // 登录态附带 Supabase token：云函数据此注入「这位读者」的个人数据（游客则无）
    supabase.auth
      .getSession()
      .then(({ data }) =>
        fetch("/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(data.session?.access_token ? { authorization: `Bearer ${data.session.access_token}` } : {}),
          },
          body: JSON.stringify({ messages: history }),
          signal: ctrl.signal,
        })
      )
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.content) throw new Error(j?.error ?? "服务暂时不可用");
        return String(j.content);
      })
      .then((answer) => {
        if (fetchCtrl.current !== ctrl) return; // 已被停止/新请求取代
        fetchCtrl.current = null;
        pendingReply.current = { id: aId, citations: [], recommendations: [] };
        let i = 0;
        timer.current = setInterval(() => {
          i += 4;
          const partial = answer.slice(0, i);
          setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: partial } : m)));
          if (i >= answer.length) {
            if (timer.current) clearInterval(timer.current);
            setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: answer, streaming: false } : m)));
            pendingReply.current = null;
            busyRef.current = false;
            setBusy(false);
          }
        }, 16);
      })
      .catch((e: unknown) => {
        if (fetchCtrl.current !== ctrl) return; // 用户主动停止，stop() 已收尾
        fetchCtrl.current = null;
        const msg = e instanceof Error && e.message && e.message !== "Failed to fetch" ? e.message : "网络开小差了，请稍后重试";
        setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: msg, streaming: false } : m)));
        busyRef.current = false;
        setBusy(false);
        toast(msg, "error");
      });
  }

  function stop() {
    if (fetchCtrl.current) { fetchCtrl.current.abort(); fetchCtrl.current = null; }
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (timer.current) clearInterval(timer.current);
    const pr = pendingReply.current;
    setMessages((prev) =>
      prev
        .map((m) => {
          if (!m.streaming) return m;
          if (pr && m.id === pr.id) return { ...m, citations: pr.citations, recommendations: pr.recommendations, streaming: false };
          return { ...m, content: m.content || "（已停止）", streaming: false };
        })
    );
    pendingReply.current = null;
    busyRef.current = false;
    setBusy(false);
  }

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
    setMessages((prev) => prev.slice(0, lastUserIdx));
    setTimeout(() => send(q), 30);
  }

  function newSession() {
    if (busy) return;
    setMessages([]);
    sessionId.current = "sess-" + Date.now();
  }

  // 语音输入：长按输入框触发（无单独图标）。识别能力在接入后端 minimax ASR 后启用
  function setRec(v: boolean) { recordingRef.current = v; setRecording(v); }
  function onRecPointerMove(e: React.PointerEvent) {
    if (!recordingRef.current || !pressStart.current) return;
    const armed = pressStart.current.y - e.clientY > 90; // 上滑超过 90px 进入「取消」态
    cancelArmedRef.current = armed;
    setCancelArmed(armed);
  }
  function endRecording() {
    if (!recordingRef.current) return;
    setRec(false);
    if (cancelArmedRef.current) {
      toast("已取消", "info");
    } else {
      toast("语音识别将在接入后端后启用，敬请期待", "info");
    }
    cancelArmedRef.current = false;
    setCancelArmed(false);
  }
  function onInputPointerDown(e: React.PointerEvent) {
    if (busy) return;
    // 仅在输入框未聚焦时，长按才触发语音；已在编辑文本时长按交给浏览器（选字/移动光标等）
    if (document.activeElement === inputRef.current) return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => { setRec(true); inputRef.current?.blur(); }, 350);
  }
  function onInputPointerEnd() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (recordingRef.current) endRecording();
  }
  function onInputPointerMove(e: React.PointerEvent) {
    // 仅当明显滑动（>12px）才取消长按，避免触摸微抖导致语音触发失败
    if (!pressTimer.current || recordingRef.current || !pressStart.current) return;
    if (Math.hypot(e.clientX - pressStart.current.x, e.clientY - pressStart.current.y) > 12) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
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
            <p className="mt-4 text-center font-serif text-xl text-ink dark:text-dark-text">你的 AI 读书伙伴</p>
            <p className="mt-1 text-center text-xs text-ink-300">通览馆藏，为你荐书 · 答疑 · 解读原文</p>
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
              <div key={m.id} id={"msg-" + m.id}>
                <ChatMessage
                  msg={m}
                  highlight={locatedId === m.id}
                  onRegenerate={!busy && m.role === "assistant" && i === messages.length - 1 ? regenerate : undefined}
                  onFeedback={(v) => setFeedback(m.id, v)}
                />
              </div>
            ))}
            <div ref={bottomRef} className="h-0 scroll-mb-[150px]" />
          </div>
        )}
      </div>

      {/* 输入区：长按输入框即可语音输入（无单独麦克风入口） */}
      <div className="app-width fixed bottom-[58px] left-1/2 z-40 -translate-x-1/2 border-t border-line bg-moon/95 px-3 py-2.5 backdrop-blur dark:border-white/5 dark:bg-dark-bg/95">
        {busy && (
          <button onClick={stop} className="mx-auto mb-2 flex items-center gap-1 rounded-full border border-line bg-snow px-3 py-1 text-xs text-ink-500 dark:bg-dark-card">
            <Square size={12} /> 停止生成
          </button>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            onPointerDown={onInputPointerDown}
            onPointerUp={onInputPointerEnd}
            onPointerLeave={onInputPointerEnd}
            onPointerMove={onInputPointerMove}
            rows={1}
            placeholder="想读点什么？问问小涤呗"
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

      {/* 录音浮层（长按时） */}
      {recording && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-ink/40 backdrop-blur-sm" onPointerMove={onRecPointerMove} onPointerUp={endRecording}>
          <div className="relative flex h-24 w-24 items-center justify-center">
            <span className={"absolute inset-0 animate-ping rounded-full " + (cancelArmed ? "bg-rouge/40" : "bg-celadon/40")} />
            <span className={"relative flex h-20 w-20 items-center justify-center rounded-full text-snow shadow-celadon " + (cancelArmed ? "bg-rouge" : "bg-celadon")}>
              {cancelArmed ? <X size={34} /> : <Mic size={34} />}
            </span>
          </div>
          <p className={"mt-6 text-sm " + (cancelArmed ? "text-rouge" : "text-snow")}>
            {cancelArmed ? "松开手指，取消发送" : "上滑取消，松开发送"}
          </p>
        </div>
      )}

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
