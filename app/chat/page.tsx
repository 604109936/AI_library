"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Send, Square, Sparkles, Mic, X, ArrowDown } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { Mascot } from "@/components/chat/Mascot";
import { Motif } from "@/components/ui/Motif";
import { getBook, getChapters, getHome } from "@/lib/api";
import { stripCardMarkers } from "@/lib/chatMarkers";
import { greeting, buildQuestions, buildGuestQuestions } from "@/lib/chatWelcome";
import { supabase } from "@/lib/supabase/client";
import { MAIN_SESSION_TITLE, useAuth, useChat, useLibrary, useUI } from "@/lib/store";
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

// 流式中间态/工具状态归一化：从持久层/缓存还原消息时修复半截状态（防永久"思考中"）
function normalizeMsgs(msgs: TMsg[]): TMsg[] {
  return msgs.map((m) =>
    m.streaming || m.toolNote !== undefined
      ? { ...m, streaming: false, toolNote: undefined, ...(m.content ? {} : { content: "这条回答没有生成完，点「重新生成」再试一次吧", error: true }) }
      : m
  );
}

// 模块级缓存：切 Tab（去泡馆/乱翻再回来）保持当前画面；按账号隔离防串号（T4 单一会话，无会话 id）
let chatLive: { messages: TMsg[]; uid: string } | null = null;
const chatLiveUid = () => useAuth.getState().user?.id ?? "guest";
function takeChatLive() {
  if (chatLive && chatLive.uid !== "guest" && chatLive.uid !== chatLiveUid()) chatLive = null; // 换账号作废；游客→登录延续
  // 中途离开时可能残留流式中间态：还原为完成态，避免回来后一直"思考中"
  if (chatLive?.messages.some((m) => m.streaming)) chatLive = { ...chatLive, messages: normalizeMsgs(chatLive.messages) };
  return chatLive;
}

// 超长会话只渲染最近这么多条：更早的内容仍完整保留在云端与小涤的记忆（压缩摘要）里
const RENDER_WINDOW = 120;

function ChatInner() {
  const sessions = useChat((s) => s.sessions);
  const toast = useUI((s) => s.toast);
  const [messages, setMessages] = useState<TMsg[]>(() => takeChatLive()?.messages ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const cancelArmedRef = useRef(false);
  const [showJump, setShowJump] = useState(false); // 用户上滑回看时浮出「回到最新」
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const seq = useRef(0);
  const fetchCtrl = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true); // 贴底跟随：用户上滑回看时停止自动滚底（流式期间被强拽回底是 P0 体验事故）
  const scrolledOnce = useRef(false); // 首次填充历史时瞬时滚到底（只做一次）
  const regenHint = useRef<string | null>(null); // 点踩后重新生成：把踩的原因喂回模型（一次性）
  const limitWarned = useRef(false); // 500 字截断只提醒一次
  const upsertSession = useChat((s) => s.upsertSession);

  // 会话续存：消息变化即回写模块缓存（流式中间态也存，回来还能看到完整画面）
  useEffect(() => {
    if (messages.length) chatLive = { messages, uid: chatLiveUid() };
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

  // 单一会话水合：本地 store（persist 已水合）或云端（loadCloud 完成后 sessions 更新）的 main
  // 会话灌入本页。流式中不动（防覆盖进行中对话）；只在 store 比当前画面更全时应用——
  // 覆盖三种时序：冷启动 persist 异步水合、登录后云端晚到、多设备间云端更新
  const mainMsgCount = sessions.find((x) => x.id === "main")?.messages.length ?? 0;
  useEffect(() => {
    if (busyRef.current || !mainMsgCount || mainMsgCount <= messages.length) return;
    const main = useChat.getState().sessions.find((x) => x.id === "main");
    if (!main) return;
    setMessages(normalizeMsgs(main.messages));
    scrolledOnce.current = false; // 重新填充后滚到底
    // eslint-disable-next-line
  }, [mainMsgCount]);

  // 统一滚动：首次填充历史时瞬时滚到底；之后仅在"贴底跟随"状态下滚到底
  useEffect(() => {
    if (!messages.length) return;
    if (!scrolledOnce.current) {
      scrolledOnce.current = true;
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" }));
      return;
    }
    if (stick.current) bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [messages]);

  // 仅在 busy true→false 边沿持久化：mount 时（切 Tab 回来、chatLive 恢复）busy 恒为 false，
  // 不跳过首跑会把会话 updatedAt 无故刷成"现在"并多写一次云端
  const busySeen = useRef(false);
  useEffect(() => {
    if (busy) { busySeen.current = true; return; }
    if (busySeen.current && messages.length) persist(messages);
    // eslint-disable-next-line
  }, [busy]);

  function persist(msgs: TMsg[]) {
    if (!msgs.some((m) => m.role === "user")) return;
    // 流式中间态绝不落持久层：busy 期间给更早消息点赞也会走到这里，若把 streaming:true 的
    // 半截消息存进本地，重开会渲染成永久"思考中"。口径与云端 cleanMsgs 对齐。
    const clean = msgs.filter((m) => !m.streaming).map((m) => (m.toolNote !== undefined ? { ...m, toolNote: undefined } : m));
    if (!clean.length) return;
    upsertSession({ id: "main", title: MAIN_SESSION_TITLE, updatedAt: new Date().toISOString(), messages: clean });
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
    // acc 提升到 send 作用域：catch 需要据此判断「中途失败但已有正文」，保留内容而非整体替换为错误文案
    let acc = "";
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
        if (!r.ok || !r.body) {
          const j = await r.json().catch(() => null);
          throw new Error(j?.error ?? "服务暂时不可用");
        }
        // T2.4 真流式：逐行消费 NDJSON 事件（文本增量/工具状态/卡片信号）。
        // MiniMax 上游以大块推送，前端用「追赶打字机」平滑渐显：落后越多追越快，体感连续。
        const apply = (patch: Partial<TMsg>) => setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, ...patch } : m)));
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
              // 流正常 end 但全程零文字零卡片（如 max_tokens 烧尽在思考段）：给错误占位而非空气泡
              if (!acc.trim() && !recsAcc.length && !citesAcc.length) {
                apply({ content: "这次没说出话来，点「重新生成」再试一次吧", streaming: false, toolNote: undefined, error: true });
              } else {
                apply({ content: acc, streaming: false, toolNote: undefined });
              }
              busyRef.current = false;
              setBusy(false);
              setShowJump(false);
            }
          }, 16);
        };
        const handle = async (ev: { t: string; v?: unknown }) => {
          if (fetchCtrl.current !== ctrl) return; // 停止/被新请求取代后不再消费缓冲区残留事件（防 await 窗口期复活僵尸打字机）
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
        if (acc.trim()) {
          // 中途失败但已流出正文（多轮工具循环后段挂掉）：保留已有内容 + 尾注说明，不打 error 标记
          // （正文与已出的卡片真实有效，整体替换成报错会让内容凭空消失、错误气泡里挂着推荐卡观感矛盾）
          setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: acc + "\n\n（后面断线了，回答可能不完整——可以点重新生成补全）", streaming: false, toolNote: undefined } : m)));
        } else {
          // 零内容失败：错误占位，并清掉可能已挂上的卡片数组（错误气泡不该出现"为你挑的书"）
          setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: msg, streaming: false, error: true, toolNote: undefined, recommendations: undefined, citations: undefined } : m)));
        }
        busyRef.current = false;
        setBusy(false);
      });
  }

  function stop() {
    if (fetchCtrl.current) { fetchCtrl.current.abort(); fetchCtrl.current = null; }
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (timer.current) { clearInterval(timer.current); timer.current = null; } // 必须置 null：陈旧 id 残留会让下次 smooth() 误判"已有打字机"
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
  // 超长会话只渲染窗口内的消息；regenerate/反馈按原数组索引判定不受影响
  const visible = messages.slice(-RENDER_WINDOW);
  const hiddenCount = messages.length - visible.length;

  return (
    <main className="min-h-[100dvh] pb-[150px]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-center bg-moon/90 px-3 backdrop-blur dark:bg-dark-bg/90">
        <span className="font-serif text-lg text-ink dark:text-dark-text">智学</span>
      </header>

      <div className="px-4">
        {empty ? (
          <Welcome onAsk={send} />
        ) : (
          <div className="space-y-4 pt-3">
            {hiddenCount > 0 && (
              <p className="pt-1 text-center text-[11px] text-ink-300">
                更早的 {hiddenCount} 条对话已收进小涤的记忆里
              </p>
            )}
            {visible.map((m, i) => (
              <div key={m.id} id={"msg-" + m.id}>
                <ChatMessage
                  msg={m}
                  onRegenerate={!busy && m.role === "assistant" && i === visible.length - 1 ? regenerate : undefined}
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
function Welcome({ onAsk }: { onAsk: (q: string) => void }) {
  const user = useAuth((s) => s.user);
  const history = useLibrary((s) => s.history);
  const progress = useLibrary((s) => s.progress);
  const favorites = useLibrary((s) => s.favorites);
  const notes = useLibrary((s) => s.notes);
  const readSeconds = useLibrary((s) => s.readSeconds);
  const openLogin = useUI((s) => s.openLogin);
  // 全馆书目（与泡馆首页共用缓存）：游客问题用真实书名，登录态用于把收藏 id 解析成书名
  const home = useQuery({ queryKey: ["home"], queryFn: getHome, staleTime: 10 * 60 * 1000 });
  const books = home.data?.recommend ?? [];

  const questions = user
    ? buildQuestions({ history, progress, favorites, notes, books })
    : buildGuestQuestions(books, home.data?.categories ?? []);

  // 开场白素材：最近接触的一本书
  const last = history[0];
  const hours = readSeconds >= 3600 ? `${(readSeconds / 3600).toFixed(1)} 小时` : `${Math.max(1, Math.round(readSeconds / 60))} 分钟`;

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
