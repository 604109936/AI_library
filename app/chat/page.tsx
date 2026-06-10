"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, History, Send, Square, Sparkles, Mic, X, ArrowDown, MessageCircle, ArrowRight } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { Mascot } from "@/components/chat/Mascot";
import { Motif } from "@/components/ui/Motif";
import { getBook, getChapters, getHome } from "@/lib/api";
import { stripCardMarkers } from "@/lib/chatMarkers";
import { greeting, buildQuestions, buildGuestQuestions } from "@/lib/chatWelcome";
import { supabase } from "@/lib/supabase/client";
import { useAuth, useChat, useLibrary, useUI } from "@/lib/store";
import { formatChatTime } from "@/lib/utils";
import type { Book, Citation, ChatMessage as TMsg } from "@/lib/types";

// 引用卡数据回填：服务端只给 {b:book_id, c:章序号}，这里拉书与章节拼出展示字段
async function buildCitations(items: { b: string; c: number }[]): Promise<Citation[]> {
  const out: Citation[] = [];
  for (const it of items.slice(0, 4)) {
    try {
      const [book, chapters] = await Promise.all([getBook(it.b), getChapters(it.b)]);
      const ch = chapters.find((x) => x.no === it.c);
      if (!book || !ch) continue;
      out.push({
        bookId: book.id,
        bookTitle: book.title,
        coverSeed: book.coverSeed,
        cover: book.cover,
        chapterNo: ch.no,
        chapterTitle: ch.title,
        snippet: (ch.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      });
    } catch {}
  }
  return out;
}

type Locate = { type: "end" } | { type: "q"; q: string } | { type: "id"; id: string };

// 模块级缓存：切 Tab（去泡馆/乱翻再回来）保持当前会话，不再每次都开新会话；按账号隔离防串号
let chatLive: { id: string; messages: TMsg[]; uid: string } | null = null;
const chatLiveUid = () => useAuth.getState().user?.id ?? "guest";
function takeChatLive() {
  if (chatLive && chatLive.uid !== "guest" && chatLive.uid !== chatLiveUid()) chatLive = null; // 换账号作废；游客→登录延续
  // 中途离开时可能残留流式中间态：还原为完成态，避免回来后一直"思考中"
  if (chatLive?.messages.some((m) => m.streaming)) {
    chatLive = {
      ...chatLive,
      messages: chatLive.messages.map((m) =>
        m.streaming
          ? m.content
            ? { ...m, streaming: false, toolNote: undefined }
            : { ...m, streaming: false, toolNote: undefined, content: "刚才断线了，点下方「重新生成」，我再说一遍", error: true }
          : m
      ),
    };
  }
  return chatLive;
}

function ChatInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const sessions = useChat((s) => s.sessions);
  const toast = useUI((s) => s.toast);
  const [messages, setMessages] = useState<TMsg[]>(() => takeChatLive()?.messages ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const cancelArmedRef = useRef(false);
  const [locatedId, setLocatedId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false); // 用户上滑回看时浮出「回到最新」
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const seq = useRef(0);
  const fetchCtrl = useRef<AbortController | null>(null);
  const pendingLocate = useRef<Locate | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true); // 贴底跟随：用户上滑回看时停止自动滚底（流式期间被强拽回底是 P0 体验事故）
  const appliedSid = useRef<string | null>(null); // 深链 ?s= 只应用一次（防 loadCloud 晚到后覆盖进行中对话）
  const regenHint = useRef<string | null>(null); // 点踩后重新生成：把踩的原因喂回模型（一次性）
  const limitWarned = useRef(false); // 500 字截断只提醒一次
  const upsertSession = useChat((s) => s.upsertSession);
  const sessionId = useRef<string>(takeChatLive()?.id ?? "sess-" + Date.now());

  // 会话续存：消息变化即回写模块缓存（流式中间态也存，回来还能看到完整画面）
  useEffect(() => {
    if (messages.length) chatLive = { id: sessionId.current, messages, uid: chatLiveUid() };
  }, [messages]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    const c = fetchCtrl.current; // 先置空再中断：避免 catch 误判为"运行中的请求出错"而在新页面弹错误 toast
    fetchCtrl.current = null;
    c?.abort();
  }, []);

  // 贴底检测：离底 < 80px 视为"在底部"，自动跟随；上滑回看即停止跟随
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const el = document.documentElement;
      const dist = el.scrollHeight - window.scrollY - window.innerHeight;
      const at = dist < 80;
      stick.current = at;
      setShowJump(!at && busyRef.current);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // 从历史打开指定会话：记录定位意图（无搜索→到最后；有搜索→命中处的最后一条）。
  // 依赖带 sessions：冷启动直链时云端会话异步加载完成后才找得到；appliedSid 防重复应用覆盖进行中对话
  useEffect(() => {
    const sid = sp.get("s");
    if (!sid || appliedSid.current === sid) return;
    const qparam = sp.get("q") ?? "";
    const mid = sp.get("mid") ?? "";
    const found = sessions.find((x) => x.id === sid);
    if (found && found.messages.length) {
      appliedSid.current = sid;
      sessionId.current = found.id;
      setMessages(found.messages);
      pendingLocate.current = mid ? { type: "id", id: mid } : qparam ? { type: "q", q: qparam } : { type: "end" };
    }
  }, [sp, sessions]);

  // 统一滚动：从历史进入按意图瞬时定位；发消息/流式时仅在"贴底跟随"状态下滚到底
  useEffect(() => {
    const pl = pendingLocate.current;
    if (pl) {
      if (messages.length === 0) return; // 会话内容尚未填充，待填充后再定位
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
    if (stick.current) bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
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
  function send(text: string, base?: TMsg[]) {
    const q = text.trim();
    if (!q || busyRef.current) return;
    busyRef.current = true;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto"; // 多行输入框复位
    if (timer.current) { clearInterval(timer.current); timer.current = null; } // 兜底清残留打字机
    stick.current = true; // 发新问题必然想看回答：恢复贴底跟随
    const n = `${Date.now()}-${seq.current++}`;
    const userMsg: TMsg = { id: "u" + n, role: "user", content: q };
    const aId = "a" + n;
    const aMsg: TMsg = { id: aId, role: "assistant", content: "", streaming: true };
    // base：重新生成时传入「已截掉旧回答」的消息列表，避免旧渲染闭包把被删的回答又拼进上下文（模型会被旧答案锚定而复读）
    // 错误/中断占位消息（error 标记）不进上下文：模型会把报错文案当成自己说过的话
    // 卡片占位标记也必须剥掉：模型看到 [[recs:0,2]] 会模仿着往回答里写
    const history = [...(base ?? messages), userMsg].filter((m) => !m.error).map((m) => ({ role: m.role, content: stripCardMarkers(m.content) }));
    // 点踩后重新生成：把踩的原因作为一次性指示喂给模型（不渲染、不落库），反馈当场可感知地生效
    if (regenHint.current) {
      history.splice(history.length - 1, 0, { role: "user", content: `（说明：你上一条回答被我标记了「${regenHint.current}」，请换个角度重新回答，不要重复原来的说法）` });
      regenHint.current = null;
    }
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
          body: JSON.stringify({ messages: history, sessionId: sessionId.current }),
          signal: ctrl.signal,
        })
      )
      .then(async (r) => {
        if (!r.ok || !r.body) {
          const j = await r.json().catch(() => null);
          throw new Error(j?.error ?? "服务暂时不可用");
        }
        // T2.4 真流式：逐行消费 NDJSON 事件（文本增量/工具状态/卡片信号）。
        // MiniMax 上游以大块推送，前端用「追赶打字机」平滑渐显：落后越多追越快，体感连续。
        const apply = (patch: Partial<TMsg>) => setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, ...patch } : m)));
        let acc = "";
        let shown = 0;
        let ended = false;
        // 卡片交错渲染：工具事件到达时把占位标记插进 acc 当前位置（正好在两轮模型文字之间），
        // 数据立即挂上消息；打字机推进到标记处卡片自然亮相——顺序与模型行为一致（理由→卡片→后话）
        const recsAcc: Book[] = [];
        const citesAcc: Citation[] = [];
        const markerSpans: [number, number][] = []; // 标记在 acc 中的区间：打字机一步跨过，不让半截标记可见
        const pushMarker = (kind: "recs" | "cites", from: number, to: number) => {
          if (!acc.endsWith("\n\n")) acc += acc.endsWith("\n") ? "\n" : "\n\n";
          const marker = `[[${kind}:${from},${to}]]\n\n`;
          markerSpans.push([acc.length, acc.length + marker.length]);
          acc += marker;
        };
        const smooth = () => {
          if (timer.current) return;
          timer.current = setInterval(() => {
            if (fetchCtrl.current !== ctrl && !ended) return; // stop() 已接管收尾
            if (shown < acc.length) {
              shown = Math.min(acc.length, shown + Math.max(2, Math.ceil((acc.length - shown) / 25)));
              for (const [s, e] of markerSpans) if (shown > s && shown < e) shown = e; // 不停在标记中间
              apply({ content: acc.slice(0, shown) }); // 不动 toolNote：工具状态由事件自己管理
            } else if (ended) {
              if (timer.current) clearInterval(timer.current);
              timer.current = null;
              apply({ content: acc, streaming: false, toolNote: undefined });
              busyRef.current = false;
              setBusy(false);
              setShowJump(false);
            }
          }, 16);
        };
        const handle = async (ev: { t: string; v?: unknown }) => {
          if (ev.t === "d" && typeof ev.v === "string") { acc += ev.v; apply({ toolNote: undefined }); smooth(); } // 新文字到达才清工具状态
          else if (ev.t === "status" && typeof ev.v === "string") apply({ toolNote: ev.v });
          else if (ev.t === "recs" && Array.isArray(ev.v)) {
            // 预取展示数据（封面/书名/作者）后插标记；handle 在行循环里被 await，期间不会有新文字混进 acc，位置不漂移
            const books = (await Promise.all((ev.v as string[]).map((id) => getBook(id).catch(() => null)))).filter(Boolean) as Book[];
            if (books.length) {
              const from = recsAcc.length;
              recsAcc.push(...books);
              pushMarker("recs", from, recsAcc.length);
              apply({ recommendations: recsAcc.slice() });
              smooth();
            }
          } else if (ev.t === "cites" && Array.isArray(ev.v)) {
            const cites = await buildCitations(ev.v as { b: string; c: number }[]);
            if (cites.length) {
              const from = citesAcc.length;
              citesAcc.push(...cites);
              pushMarker("cites", from, citesAcc.length);
              apply({ citations: citesAcc.slice() });
              smooth();
            }
          } else if (ev.t === "err") throw new Error(typeof ev.v === "string" ? ev.v : "服务暂时不可用");
        };
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) await handle(JSON.parse(line));
          }
        }
        if (fetchCtrl.current !== ctrl) return; // 已被停止/新请求取代
        fetchCtrl.current = null;
        ended = true;
        smooth(); // 流结束：让打字机追完剩余文字后收尾（若无任何增量也会直接收尾）
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return; // 卸载/停止导致的中断不是错误
        if (fetchCtrl.current !== ctrl) return; // 用户主动停止，stop() 已收尾
        fetchCtrl.current = null;
        // 必须清掉打字机 interval：否则残留空转的旧 interval 会让下一次提问永远渲染不出字（P0）
        if (timer.current) { clearInterval(timer.current); timer.current = null; }
        const msg = e instanceof Error && e.message && e.message !== "Failed to fetch" ? e.message : "网络有点不稳，缓一缓再问我一次吧";
        // 错误进气泡即可（带重新生成按钮），不再叠一个 toast 双重打扰；error 标记防止进上下文
        setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: msg, streaming: false, error: true } : m)));
        busyRef.current = false;
        setBusy(false);
      });
  }

  function stop() {
    if (fetchCtrl.current) { fetchCtrl.current.abort(); fetchCtrl.current = null; }
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (timer.current) clearInterval(timer.current);
    // 卡片数据在事件到达时已挂上消息：内容里有标记按标记位置渲染，标记没吐到则回退末尾渲染，不会丢卡
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.streaming) return m;
        return m.content
          ? { ...m, streaming: false, toolNote: undefined }
          : { ...m, content: "好，先停在这里。想继续随时叫我", streaming: false, toolNote: undefined, error: true };
      })
    );
    busyRef.current = false;
    setBusy(false);
    setShowJump(false);
  }

  function setFeedback(id: string, v: "up" | "down" | null) {
    const next = messages.map((m) => (m.id === id ? { ...m, feedback: v ?? undefined } : m));
    setMessages(next);
    persist(next);
  }

  // 踩反馈原因随消息落库（T2.5：persist 会写穿透 chat_sessions）
  function setFeedbackDetail(id: string, reasons: string[], text: string) {
    const next = messages.map((m) =>
      m.id === id ? { ...m, feedbackReasons: reasons.length ? reasons : undefined, feedbackText: text || undefined } : m
    );
    setMessages(next);
    persist(next);
  }

  function regenerate() {
    if (busy) return;
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const q = messages[lastUserIdx].content;
    // 被重新生成的回答若被踩过，把原因一次性喂回模型（反馈闭环：用户当场看到"它听进去了"）
    const replaced = messages[lastUserIdx + 1];
    if (replaced?.feedback === "down") {
      regenHint.current = replaced.feedbackReasons?.length ? replaced.feedbackReasons.join("、") : "不满意";
    }
    const base = messages.slice(0, lastUserIdx); // 显式传给 send：旧闭包里的 messages 还带着被删的回答
    setMessages(base);
    setTimeout(() => send(q, base), 30);
  }

  function newSession() {
    if (busy) { toast("等小涤说完这句，或先点停止生成", "info"); return; }
    if (messages.length === 0) return;
    setMessages([]);
    sessionId.current = "sess-" + Date.now();
    chatLive = null; // 主动开新会话才清掉续存
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
      toast("语音功能快来了，先打字告诉我吧", "info");
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

  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const raw = e.target.value;
    if (raw.length > 500 && !limitWarned.current) {
      limitWarned.current = true;
      toast("一次最多 500 字，长段落可以分两次发我", "info");
    }
    if (raw.length <= 450) limitWarned.current = false;
    setInput(raw.slice(0, 500));
    // 多行自适应：随内容长高，封顶 96px（与 max-h-24 一致）后内部滚动
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 96) + "px";
  }

  const empty = messages.length === 0;

  return (
    <main className="min-h-[100dvh] pb-[150px]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-moon/90 px-3 backdrop-blur dark:bg-dark-bg/90">
        <Link href="/chat/history" className="flex h-9 w-9 items-center justify-center rounded-full active:bg-line/50 dark:active:bg-white/10">
          <History size={20} className="text-ink-700 dark:text-dark-text" />
        </Link>
        <span className="font-serif text-lg text-ink dark:text-dark-text">智学</span>
        <button onClick={newSession} aria-label="开启新对话" className={"flex h-9 w-9 items-center justify-center rounded-full active:bg-line/50 dark:active:bg-white/10" + (busy ? " opacity-40" : "")}>
          <Plus size={22} className="text-ink-700 dark:text-dark-text" />
        </button>
      </header>

      <div className="px-4">
        {empty ? (
          <Welcome onAsk={send} onResume={(sid) => router.push(`/chat?s=${sid}`)} />
        ) : (
          <div className="space-y-4 pt-3">
            {messages.map((m, i) => (
              <div key={m.id} id={"msg-" + m.id}>
                <ChatMessage
                  msg={m}
                  highlight={locatedId === m.id}
                  onRegenerate={!busy && m.role === "assistant" && i === messages.length - 1 ? regenerate : undefined}
                  onFeedback={(v) => setFeedback(m.id, v)}
                  onFeedbackDetail={(reasons, text) => setFeedbackDetail(m.id, reasons, text)}
                />
              </div>
            ))}
            <div ref={bottomRef} className="h-0 scroll-mb-[150px]" />
          </div>
        )}
      </div>

      {/* 上滑回看时浮出「回到最新」：恢复贴底跟随 */}
      {showJump && (
        <button
          onClick={() => { stick.current = true; setShowJump(false); bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }}
          className="fixed bottom-[170px] left-1/2 z-40 flex -translate-x-1/2 animate-fade-up items-center gap-1 rounded-full border border-line bg-snow/95 px-3.5 py-1.5 text-xs text-ink-700 shadow-md backdrop-blur dark:border-white/10 dark:bg-dark-card/95 dark:text-dark-text"
        >
          <ArrowDown size={13} className="text-celadon" /> 回到最新
        </button>
      )}

      {/* 输入区：长按输入框即可语音输入（无单独麦克风入口） */}
      <div className="app-width fixed bottom-[58px] left-1/2 z-40 -translate-x-1/2 border-t border-line bg-moon/95 px-3 py-2.5 backdrop-blur dark:border-white/5 dark:bg-dark-bg/95">
        {busy && (
          <button onClick={stop} className="mx-auto mb-2 flex items-center gap-1 rounded-full border border-line bg-snow px-3 py-1 text-xs text-ink-500 dark:border-white/10 dark:bg-dark-card dark:text-dark-text/70">
            <Square size={12} /> 停止生成
          </button>
        )}
        {input.length >= 450 && (
          <p className={"mb-1 pr-1 text-right text-[11px] " + (input.length >= 500 ? "text-rouge" : "text-ink-300")}>{input.length}/500</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={(e) => {
              // isComposing：输入法候选未上屏时按 Enter 是"选词"，不能把半截拼音发出去
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
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
            aria-label="发送"
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

/* 欢迎区（UI Review 个性化重设计）：
   登录 → 时段问候喊昵称 + 小涤"汇报近况"开场白（本地拼装 0 token）+ 按读者数据动态生成的示例问题 + 续聊上次话题；
   游客 → 示例问题全部来自真实馆藏（绝不出现馆里没有的书）+ 一句克制的登录钩子。 */
function Welcome({ onAsk, onResume }: { onAsk: (q: string) => void; onResume: (sid: string) => void }) {
  const user = useAuth((s) => s.user);
  const history = useLibrary((s) => s.history);
  const progress = useLibrary((s) => s.progress);
  const favorites = useLibrary((s) => s.favorites);
  const notes = useLibrary((s) => s.notes);
  const readSeconds = useLibrary((s) => s.readSeconds);
  const sessions = useChat((s) => s.sessions);
  const openLogin = useUI((s) => s.openLogin);
  const [hideResume, setHideResume] = useState(false);
  // 全馆书目（与泡馆首页共用缓存）：游客问题用真实书名，登录态用于把收藏 id 解析成书名
  const home = useQuery({ queryKey: ["home"], queryFn: getHome, staleTime: 10 * 60 * 1000 });
  const books = home.data?.recommend ?? [];

  const questions = user
    ? buildQuestions({ history, progress, favorites, notes, books })
    : buildGuestQuestions(books, home.data?.categories ?? []);

  // 开场白素材：最近接触的一本书
  const last = history[0];
  const hours = readSeconds >= 3600 ? `${(readSeconds / 3600).toFixed(1)} 小时` : `${Math.max(1, Math.round(readSeconds / 60))} 分钟`;
  // 续聊条：最近一次会话在 24 小时内才提（太久远的话题再提反而尴尬）
  const lastSession = sessions[0];
  const resumable =
    !hideResume && lastSession && lastSession.messages.length > 0 && Date.now() - +new Date(lastSession.updatedAt) < 24 * 3600 * 1000;

  return (
    <div className="relative flex flex-col items-center pt-8">
      <Motif name="bamboo" className="pointer-events-none absolute -top-2 right-0 h-20 w-20 text-celadon/30" />
      <Mascot size={84} className="shadow-celadon" />
      {user ? (
        <>
          <p className="mt-4 text-center font-serif text-xl text-ink dark:text-dark-text">
            {greeting()}，<span className="text-celadon-700 dark:text-celadon-300">{user.nickname}</span>
          </p>
          <p className="mt-1 text-center text-xs text-ink-300">我是小涤，今天想读点什么？</p>
        </>
      ) : (
        <>
          <p className="mt-4 text-center font-serif text-xl text-ink dark:text-dark-text">我是小涤，你的读书伙伴</p>
          <p className="mt-1 text-center text-xs text-ink-300">馆里每本书我都翻过——荐书 · 答疑 · 解读原文</p>
        </>
      )}

      {/* 小涤开场白：汇报阅读近况（仅登录且有阅读记录；纯本地拼装） */}
      {user && last && (
        <div className="mt-5 w-full animate-fade-up">
          <div className="rounded-2xl rounded-tl-sm bg-snow px-3.5 py-3 text-sm leading-6 text-ink-700 shadow-sm dark:bg-dark-card dark:text-dark-text/85">
            {last.progress >= 100 ? (
              <>你在馆里已读 <b className="text-ink dark:text-dark-text">{hours}</b>，上次把《{last.bookTitle}》读完了——要不要我接着给你挑下一本？</>
            ) : (
              <>你在馆里已读 <b className="text-ink dark:text-dark-text">{hours}</b>。《{last.bookTitle}》进行到 <b className="text-ink dark:text-dark-text">{Math.round(last.progress)}%</b>——接着读，还是换个口味让我荐一本？</>
            )}
            <div className="mt-2.5 flex gap-2">
              {last.progress < 100 && (
                <Link
                  href={last.mode === "text" ? `/library/book/${last.bookId}/read` : `/library/book/${last.bookId}`}
                  className="rounded-full bg-celadon px-3.5 py-1.5 text-xs text-snow active:scale-95"
                >
                  继续读这本
                </Link>
              )}
              <button
                onClick={() => onAsk("根据我的阅读记录，推荐我下一本读什么")}
                className="rounded-full border border-celadon/60 px-3.5 py-1.5 text-xs text-celadon-700 active:scale-95 dark:text-celadon-300"
              >
                给我荐一本
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 续聊上次话题 */}
      {resumable && (
        <div className="mt-3 flex w-full items-center gap-2.5 rounded-xl bg-snow px-3 py-2.5 shadow-sm dark:bg-dark-card">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-celadon-soft dark:bg-celadon/20">
            <MessageCircle size={14} className="text-celadon-700 dark:text-celadon-300" />
          </span>
          <button onClick={() => onResume(lastSession.id)} className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs text-ink-700 dark:text-dark-text/80">
              上次聊到「<span className="font-medium text-ink dark:text-dark-text">{lastSession.title}</span>」
            </p>
            <p className="mt-0.5 text-[11px] text-ink-300">{formatChatTime(lastSession.updatedAt)} · 点这里接着聊</p>
          </button>
          <button onClick={() => onResume(lastSession.id)} aria-label="继续上次对话" className="flex h-8 w-8 shrink-0 items-center justify-center text-celadon-700 dark:text-celadon-300">
            <ArrowRight size={15} />
          </button>
          <button onClick={() => setHideResume(true)} aria-label="不再提示" className="flex h-8 w-8 shrink-0 items-center justify-center text-ink-300">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="mt-5 w-full space-y-2.5">
        {questions.map((q) => (
          <button
            key={q}
            onClick={() => onAsk(q)}
            className="flex w-full items-center gap-2 rounded-xl bg-snow px-4 py-3 text-left text-sm text-ink-700 shadow-sm active:scale-[0.99] dark:bg-dark-card dark:text-dark-text"
          >
            <Sparkles size={14} className="shrink-0 text-celadon" />
            <span>
              {/* 书名提色：一眼看出"它知道我在读什么" */}
              {q.split(/(《[^》]+》)/).map((part, i) =>
                part.startsWith("《") ? (
                  <span key={i} className="font-medium text-celadon-700 dark:text-celadon-300">{part}</span>
                ) : (
                  <span key={i}>{part}</span>
                )
              )}
            </span>
          </button>
        ))}
      </div>

      {/* 游客登录钩子：一句话，不弹窗不打断 */}
      {!user && (
        <button onClick={() => openLogin()} className="mt-4 text-xs text-ink-300">
          登录后，小涤能记得你读过的每一本书 · <span className="text-celadon-700 dark:text-celadon-300">去登录</span>
        </button>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-500">小涤正在赶来…</div>}>
      <ChatInner />
    </Suspense>
  );
}
