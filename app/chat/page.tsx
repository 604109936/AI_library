"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import { msgIdTime } from "@/lib/utils";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useVoiceInput, voiceSupported } from "@/lib/useVoiceInput";
import type { Book, Citation, WebSource, ChatMessage as TMsg } from "@/lib/types";

// 引用卡数据：T3 起服务端 cites 事件直带全部展示字段（书名/章题/snippet/封面），前端零查询直渲染——
// 既消除"拉数据失败丢卡"的失配源，也不再为 60 字摘要拉整本书正文。兼容旧格式（{b,c}）时回退轻量查询
async function buildCitations(items: { b: string; c: number; bt?: string; ct?: string; sn?: string; cs?: number; cv?: string }[]): Promise<Citation[]> {
  const out: Citation[] = [];
  for (const it of items.slice(0, 4)) {
    if (it.bt && it.ct !== undefined) {
      out.push({ bookId: it.b, bookTitle: it.bt, coverSeed: it.cs ?? 1, cover: it.cv ?? "", chapterNo: it.c, chapterTitle: it.ct ?? "", snippet: it.sn ?? "" });
      continue;
    }
    // 旧格式兜底（历史在途请求）：轻量拼装
    try {
      const [book, chapters] = await Promise.all([getBook(it.b), getChapters(it.b)]);
      const ch = chapters.find((x) => x.no === it.c);
      if (!book || !ch) continue;
      out.push({ bookId: book.id, bookTitle: book.title, coverSeed: book.coverSeed, cover: book.cover, chapterNo: ch.no, chapterTitle: ch.title, snippet: (ch.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60) });
    } catch {}
  }
  return out;
}

// 降级书目：仅用事件自带的 {id,title} 构造可点进详情页的最小卡（封面走 BookCover 的 CSS 兜底）
function degradedBook(id: string, title: string): Book {
  return {
    id, title, author: "", cover: "", coverSeed: 1, heroUrl: "", posterUrl: "", category: "", categoryId: "",
    tags: [], summary: "", rating: 0, readers: 0, words: 0, durationMin: 0,
    hasVideo: false, hasAudio: false, hasText: false, likes: 0, favCount: 0, reviewCount: 0,
    featured: false, intro: "", shelvedAt: "",
  } as Book;
}

// 推荐卡数据：getBook 失败重试一次；仍失败用事件自带的 {id,title} 构造降级书目（保底可点进详情页）
async function resolveRecBooks(items: (string | { id: string; title: string })[]): Promise<Book[]> {
  const out: Book[] = [];
  for (const it of items) {
    const id = typeof it === "string" ? it : it.id;
    const title = typeof it === "string" ? "" : it.title;
    let book: Book | null = null;
    try { book = await getBook(id); } catch { try { book = await getBook(id); } catch {} }
    if (book) out.push(book);
    else if (title) out.push(degradedBook(id, title));
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
  const voiceAborting = useRef(false); // 识别启动期间松手 → 启动完成后放弃
  const { voice, startVoice, stopVoice } = useVoiceInput();
  // 录音期间锁页面滚动：触屏上滑取消的手势若引发页面滚动，浏览器会发 pointercancel 终止手势
  useLockBodyScroll(recording);
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

  // 最新消息引用：稳定回调（setFeedback 等）与卸载兜底从这里取值，避免陈旧闭包
  const messagesRef = useRef<TMsg[]>(messages);
  // 会话续存：消息变化即回写模块缓存（流式中间态也存，回来还能看到完整画面）
  useEffect(() => {
    messagesRef.current = messages;
    if (messages.length) chatLive = { messages, uid: chatLiveUid() };
  }, [messages]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    const c = fetchCtrl.current; // 先置空再中断：避免 catch 误判为"运行中的请求出错"而在新页面弹错误 toast
    fetchCtrl.current = null;
    c?.abort();
    // 流式中离开页面：本轮问答此前只存在内存级 chatLive 里（persist 只在 busy 边沿触发），
    // 此刻硬刷新/杀进程会让刚发的提问凭空消失——离开时把画面快照（半截回答转完成态）落一次库
    const snap = messagesRef.current;
    if (busyRef.current && snap.some((m) => m.streaming)) {
      busyRef.current = false;
      persist(normalizeMsgs(snap));
    }
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
    // 与 store 中 main 做消息级并集（按 id 去重 + 按 id 时间戳稳定排序）后再落库：
    // busy 期间 loadCloud 返回的完整云端历史会被水合 effect 跳过（防覆盖进行中对话），
    // 流结束后若直接用页面短列表落库，会把云端几十条历史整段洗掉（P0：永久丢数据）
    const main = useChat.getState().sessions.find((x) => x.id === "main");
    let merged = clean;
    if (main?.messages.length) {
      const ids = new Set(clean.map((m) => m.id));
      const missing = main.messages.filter((m) => !ids.has(m.id));
      if (missing.length) merged = [...missing, ...clean].sort((a, b) => msgIdTime(a.id) - msgIdTime(b.id));
    }
    upsertSession({ id: "main", title: MAIN_SESSION_TITLE, updatedAt: new Date().toISOString(), messages: merged });
    // 合并出了页面没有的历史：灌回页面（非 busy 时点；busy 中不会走到 merged>页面 的路径）
    if (merged.length > msgs.length && !busyRef.current) {
      setMessages(normalizeMsgs(merged));
    }
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
    // 消息 id 时间戳单调化：persist 合并按 msgIdTime 排序，本机时钟回拨/多端钟差时
    // 新消息若拿到更小时间戳会被排进历史中部（页面追加序与落库序分叉）
    const lastT = (base ?? messages).reduce((mx, m) => Math.max(mx, msgIdTime(m.id)), 0);
    const n = `${Math.max(Date.now(), lastT + 1)}-${seq.current++}`;
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
        const webAcc: WebSource[] = [];
        const markerSpans: [number, number][] = []; // 标记在 acc 中的区间：打字机一步跨过，不让半截标记可见
        const pushMarker = (kind: "recs" | "cites" | "web", from: number, to: number) => {
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
              // 后台标签页 interval 被节流到约 1Hz，追赶公式在 1Hz 下追完长回答要几十秒——
              // 不可见时直接全量上屏，切回来即是完整回答而不是"还在慢慢爬"
              if (document.hidden) shown = acc.length;
              else shown = Math.min(acc.length, shown + Math.max(2, Math.ceil((acc.length - shown) / 25)));
              for (const [s, e] of markerSpans) if (shown > s && shown < e) shown = e; // 不停在标记中间
              apply({ content: acc.slice(0, shown) }); // 不动 toolNote：工具状态由事件自己管理
            } else if (ended) {
              if (timer.current) clearInterval(timer.current);
              timer.current = null;
              // 流正常 end 但全程零文字零卡片（如 max_tokens 烧尽在思考段）：给错误占位而非空气泡
              if (!acc.trim() && !recsAcc.length && !citesAcc.length && !webAcc.length) {
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
        // 事件去重再 apply：每个 delta 都清一次 toolNote / 同值 status 重复写，都会给目标消息
        // 换引用触发整列表 setMessages——只有真的变化才动状态
        let noteShown: string | undefined;
        const handle = async (ev: { t: string; v?: unknown }) => {
          if (fetchCtrl.current !== ctrl) return; // 停止/被新请求取代后不再消费缓冲区残留事件（防 await 窗口期复活僵尸打字机）
          if (ev.t === "d" && typeof ev.v === "string") {
            acc += ev.v;
            if (noteShown !== undefined) { noteShown = undefined; apply({ toolNote: undefined }); } // 新文字到达才清工具状态
            smooth();
          }
          else if (ev.t === "status" && typeof ev.v === "string") { if (noteShown !== ev.v) { noteShown = ev.v; apply({ toolNote: ev.v }); } }
          else if (ev.t === "recs" && Array.isArray(ev.v)) {
            // 先用事件自带 {id,title} 即时构造降级卡并就地渲染（标记位置由当下 acc 决定，顺序不漂移）；
            // 真实封面/作者放进“不被读循环 await”的后台 Promise 富化，完成后按 id 就地替换——避免在
            // NDJSON 读循环内逐本串行 getBook(带重试)阻塞后续 delta/end 消费致打字机卡顿（Bug#4）
            const rawRecs = (ev.v as (string | { id: string; title: string })[])
              .map((it) => (typeof it === "string" ? { id: it, title: "" } : it))
              .filter((it) => it && it.id);
            if (rawRecs.length) {
              const from = recsAcc.length;
              recsAcc.push(...rawRecs.map((it) => degradedBook(it.id, it.title)));
              pushMarker("recs", from, recsAcc.length);
              apply({ recommendations: recsAcc.slice() });
              smooth();
              void (async () => {
                const rich = await resolveRecBooks(rawRecs);
                if (fetchCtrl.current !== ctrl || !rich.length) return; // 已停止/被新请求取代：不再回填已定格的消息
                const byId = new Map(rich.map((b) => [b.id, b]));
                for (let i = 0; i < recsAcc.length; i++) { const b = byId.get(recsAcc[i].id); if (b) recsAcc[i] = b; }
                apply({ recommendations: recsAcc.slice() });
              })();
            }
          } else if (ev.t === "cites" && Array.isArray(ev.v)) {
            const cites = await buildCitations(ev.v as { b: string; c: number }[]);
            if (fetchCtrl.current !== ctrl) return; // await 期间被停止：同上
            if (cites.length) {
              const from = citesAcc.length;
              citesAcc.push(...cites);
              pushMarker("cites", from, citesAcc.length);
              apply({ citations: citesAcc.slice() });
              smooth();
            }
          } else if (ev.t === "web" && ev.v && Array.isArray((ev.v as { items?: unknown }).items)) {
            // 联网来源卡（T10）：事件直带 title/url/date，零查询直渲染
            const items = (ev.v as { items: WebSource[] }).items.filter((x) => x?.t && x?.u);
            if (items.length) {
              const from = webAcc.length;
              webAcc.push(...items);
              pushMarker("web", from, webAcc.length);
              apply({ webSources: webAcc.slice() });
              smooth();
            }
          } else if (ev.t === "err") throw new Error(typeof ev.v === "string" ? ev.v : "服务暂时不可用");
        };
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        // 单行解析容错：某一行损坏（代理截断/编码异常）只跳过该行，绝不让整个流中断（T3 加固）
        const handleLine = async (line: string) => {
          if (!line) return;
          let ev: { t: string; v?: unknown } | null = null;
          try { ev = JSON.parse(line); } catch { return; }
          if (ev) await handle(ev);
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            await handleLine(line);
          }
        }
        buf += dec.decode(); // 冲洗解码器内部残留的半截多字节序列（流在中文字符中间被截断时少 1 字会让末行 JSON 解析失败）
        await handleLine(buf.trim()); // 末行可能没有换行符（代理缓冲截断）：不 flush 会整行丢事件
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
          // 中途失败但已流出正文（多轮工具循环后段挂掉）：保留模型真实正文 + truncated 标记，不打 error。
          // 尾注由渲染层据 truncated 追加，content 不掺尾注——否则下一轮 history 会把"（后面断线了…）"
          // 当成模型自己说过的话回灌污染上下文（Bug#11）。正文与已出卡片真实有效，不整体替换成报错。
          setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: acc, streaming: false, toolNote: undefined, truncated: true } : m)));
        } else {
          // 零内容失败：错误占位，并清掉可能已挂上的卡片数组（错误气泡不该出现"为你挑的书"）
          setMessages((prev) => prev.map((m) => (m.id === aId ? { ...m, content: msg, streaming: false, error: true, toolNote: undefined, recommendations: undefined, citations: undefined, webSources: undefined } : m)));
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

  // 反馈回调必须是稳定引用（useCallback + 子组件回传 id）：内联箭头函数每次渲染都换引用，
  // ChatMessage 的 memo 浅比较对每条消息都失败——打字机 16ms 一拍时 120 条 ReactMarkdown
  // 全量重解析，正是注释承诺"其余跳过"却从未发生的卡顿大头。取值走 messagesRef 防陈旧闭包
  const setFeedback = useCallback((id: string, v: "up" | "down" | null) => {
    const next = messagesRef.current.map((m) => (m.id === id ? { ...m, feedback: v ?? undefined } : m));
    setMessages(next);
    persist(next);
    // eslint-disable-next-line
  }, []);

  // 踩反馈原因随消息落库（T2.5：persist 会写穿透 chat_sessions）
  const setFeedbackDetail = useCallback((id: string, reasons: string[], text: string) => {
    const next = messagesRef.current.map((m) =>
      m.id === id ? { ...m, feedbackReasons: reasons.length ? reasons : undefined, feedbackText: text || undefined } : m
    );
    setMessages(next);
    persist(next);
    // eslint-disable-next-line
  }, []);

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

  // 语音输入（T6）：长按输入框说话 → 松开识别文本回填输入框 → 上滑取消。
  // 识别走浏览器原生 SpeechRecognition（MiniMax 无 ASR，决策见 evidence/T6）；不支持的环境降级提示
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
    const canceled = cancelArmedRef.current;
    const { text, fatal } = stopVoice(canceled);
    if (canceled) {
      toast("已取消", "info");
    } else if (text) {
      // 识别文本回填输入框供确认后发送（误识可改可删，比直接发送稳）
      setInput((cur) => (cur ? cur + text : text).slice(0, 500));
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (fatal) {
      // 权限被拒/无麦克风：识别器异步报 not-allowed（start 本身不抛错），原"没听清"文案是三重误导
      toast("麦克风没打开——请在浏览器设置里允许使用麦克风", "error");
    } else {
      toast("没听清，再试一次或打字告诉我", "info");
    }
    cancelArmedRef.current = false;
    setCancelArmed(false);
  }
  function onInputPointerDown(e: React.PointerEvent) {
    if (busy) return;
    // 录音中/长按窗口内第二根手指（掌缘误触）再落下：忽略——否则两个定时器都会触发 startVoice，
    // 双识别器并存会清掉已识别文本且旧识别器占着麦克风不放
    if (recordingRef.current || pressTimer.current) return;
    // 仅在输入框未聚焦时，长按才触发语音；已在编辑文本时长按交给浏览器（选字/移动光标等）
    if (document.activeElement === inputRef.current) return;
    pressStart.current = { x: e.clientX, y: e.clientY };
    // 指针捕获：录音浮层渲染后会遮住输入框，没有 capture 时鼠标指针被判定"离开"输入框 →
    // pointerleave → endRecording → 浮层一出现就自杀。capture 后事件全程派给输入框，遮挡无影响
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    pressTimer.current = setTimeout(async () => {
      if (recordingRef.current) return; // 竞态兜底：已在录音绝不再起一个识别器
      if (!voiceSupported()) {
        toast("当前浏览器不支持语音输入，可以用键盘自带的语音键", "info");
        return;
      }
      voiceAborting.current = false;
      inputRef.current?.blur();
      const okStart = await startVoice();
      if (!okStart) {
        toast("麦克风没打开——请在浏览器设置里允许使用麦克风", "error");
        return;
      }
      if (voiceAborting.current) { stopVoice(true); return; } // 启动期间手已松开
      setRec(true);
    }, 350);
  }
  function onInputPointerEnd() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (recordingRef.current) endRecording();
    else voiceAborting.current = true; // 长按定时器已触发但识别还在启动中就松了手：启动完成后直接放弃
  }
  // 触屏滚动等系统手势抢占（pointercancel）：一律按"取消"处理——此时用户多半在上滑，
  // 若当作"确认松手"会把半截话回填进输入框，与取消意图正好相反
  function onInputPointerCancel() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (recordingRef.current) {
      setRec(false);
      stopVoice(true);
      toast("已取消", "info");
      cancelArmedRef.current = false;
      setCancelArmed(false);
    } else {
      voiceAborting.current = true;
    }
  }
  function onInputPointerMove(e: React.PointerEvent) {
    // 指针已被输入框 capture：录音中的"上滑取消"判定也由这里驱动（浮层的 onPointerMove 是无 capture 环境的兜底）
    if (recordingRef.current) { onRecPointerMove(e); return; }
    // 仅当明显滑动（>12px）才取消长按，避免触摸微抖导致语音触发失败
    if (!pressTimer.current || !pressStart.current) return;
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
    // 全部底部锚定都要计入 env(safe-area-inset-bottom)：BottomNav 实际高度=58px+inset，
    // 固定 58px 会让输入条在 iOS PWA/手势导航机型上与导航条重叠、下沿被盖住误触 Tab
    <main className="min-h-[100dvh] pb-[calc(150px+env(safe-area-inset-bottom))]">
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
                  onFeedback={setFeedback}
                  onFeedbackDetail={setFeedbackDetail}
                />
              </div>
            ))}
            <div ref={bottomRef} className="h-0 scroll-mb-[calc(150px+env(safe-area-inset-bottom))]" />
          </div>
        )}
      </div>

      {/* 上滑回看时浮出「回到最新」：恢复贴底跟随 */}
      {showJump && (
        <button
          onClick={() => { stick.current = true; setShowJump(false); bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }}
          className="fixed bottom-[calc(170px+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 animate-fade-up items-center gap-1 rounded-full border border-line bg-snow/95 px-3.5 py-1.5 text-xs text-ink-700 shadow-md backdrop-blur dark:border-white/10 dark:bg-dark-card/95 dark:text-dark-text"
        >
          <ArrowDown size={13} className="text-celadon" /> 回到最新
        </button>
      )}

      {/* 输入区：长按输入框即可语音输入（无单独麦克风入口） */}
      <div className="app-width fixed bottom-[calc(58px+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 border-t border-line bg-moon/95 px-3 py-2.5 backdrop-blur dark:border-white/5 dark:bg-dark-bg/95">
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
            onPointerCancel={onInputPointerCancel}
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

      {/* 录音浮层（长按说话 / 上滑取消 / 松开回填输入框）：实时识别文字 + 音量波形 + 计时 */}
      {recording && (
        <div role="alertdialog" aria-label="语音输入中" className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-ink/45 backdrop-blur-sm" onPointerMove={onRecPointerMove} onPointerUp={endRecording}>
          {/* 实时识别文本：边说边出，给"它在听"的确定感；aria-live 让读屏用户也知道在听 */}
          <div className="mb-6 min-h-[3.5rem] max-w-[78%] text-center" aria-live="polite">
            {voice.text ? (
              <p className="text-base leading-7 text-snow">{voice.text}</p>
            ) : (
              <p className="text-sm text-snow/55">说吧，我听着</p>
            )}
          </div>
          <div className="relative flex h-24 w-24 items-center justify-center">
            <span className={"absolute inset-0 animate-ping rounded-full " + (cancelArmed ? "bg-rouge/40" : "bg-celadon/40")} />
            <span className={"relative flex h-20 w-20 items-center justify-center rounded-full text-snow shadow-celadon " + (cancelArmed ? "bg-rouge" : "bg-celadon")}>
              {cancelArmed ? <X size={34} /> : <Mic size={34} />}
            </span>
          </div>
          {/* 音量波形（7 柱随实时音量起伏；拿不到音量流时匀速呼吸回退） */}
          <div className="mt-5 flex h-8 items-center gap-1" aria-hidden>
            {[0.5, 0.8, 1, 0.7, 0.95, 0.65, 0.45].map((k, i) =>
              voice.level >= 0 ? (
                <span
                  key={i}
                  className={"w-1 rounded-full transition-[height] duration-100 " + (cancelArmed ? "bg-rouge/80" : "bg-snow/85")}
                  style={{ height: `${Math.round(6 + k * voice.level * 22)}px` }}
                />
              ) : (
                <span key={i} className={"voice-bar w-1 rounded-full " + (cancelArmed ? "bg-rouge/80" : "bg-snow/85")} style={{ animationDelay: `${i * 0.12}s` }} />
              )
            )}
          </div>
          <p className="mt-2 text-xs tabular-nums text-snow/70">{`${String(Math.floor(voice.seconds / 60)).padStart(2, "0")}:${String(voice.seconds % 60).padStart(2, "0")}`}</p>
          <p className={"mt-4 text-sm " + (cancelArmed ? "text-rouge" : "text-snow")}>
            {cancelArmed ? "松开手指，取消这段话" : "上滑取消，松开把文字填进输入框"}
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
    <Suspense fallback={<div className="p-8 text-center text-ink-500">小涤正在赶来</div>}>
      <ChatInner />
    </Suspense>
  );
}
