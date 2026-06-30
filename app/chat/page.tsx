"use client";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Send, Sparkles, ArrowDown } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { Mascot } from "@/components/chat/Mascot";
import { Motif } from "@/components/ui/Motif";
import { getBook, getChapters, getHome } from "@/lib/api";
import { stripCardMarkers } from "@/lib/chatMarkers";
import { buildQuestions, buildGuestQuestions } from "@/lib/chatWelcome";
import { supabase } from "@/lib/supabase/client";
import { MAIN_SESSION_TITLE, useAuth, useChat, useLibrary, useUI } from "@/lib/store";
import { msgIdTime } from "@/lib/utils";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useVoiceInput, voiceSupported } from "@/lib/useVoiceInput";
import { useStreamVoiceInput, streamVoiceSupported } from "@/lib/useStreamVoiceInput";
import type { Book, Citation, WebSource, ChatMessage as TMsg } from "@/lib/types";

// useLayoutEffect 在 SSR 无意义→客户端才用（消除告警）。用于在浏览器「绘制前」补历史，避免先闪欢迎/载入再跳历史。
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

// 流式中间态/工具状态归一化：从持久层/缓存还原消息时修复半截状态（防永久"思考中"）
function normalizeMsgs(msgs: TMsg[]): TMsg[] {
  // 先丢掉录音占位（voicePending）：识别等待中切走会把空内容的占位落库，重开会永久渲染跳动点「…」幽灵气泡
  return msgs.filter((m) => !m.voicePending).map((m) =>
    m.streaming || m.toolNote !== undefined
      ? { ...m, streaming: false, toolNote: undefined, ...(m.content ? {} : { content: "这条回答没有生成完，点「重新生成」再试一次吧", error: true }) }
      : m
  );
}

// 模块级会话 + 流式机器：跨 Tab 切换（组件卸载）持续运行——切走不中断请求、切回接着看（回复到哪就是哪）。
// chatLive 是「当前会话消息」的源真相（持久于模块、不随卸载消失）；页面用 useSyncExternalStore 订阅它。
// 按账号隔离防串号（T4 单一会话，无会话 id）。
let chatLive: { messages: TMsg[]; uid: string } | null = null;
const chatLiveUid = () => useAuth.getState().user?.id ?? "guest";
const EMPTY_MSGS: TMsg[] = [];
const liveSubs = new Set<() => void>();
function emitLive() { liveSubs.forEach((fn) => fn()); }
// 全局唯一「写消息」：所有增删改都走它——更新 chatLive + 通知挂载中的页面刷新（卸载时无订阅者，但 chatLive 照常更新）
function writeLive(arg: TMsg[] | ((prev: TMsg[]) => TMsg[])) {
  const prev = chatLive?.messages ?? EMPTY_MSGS;
  const next = typeof arg === "function" ? (arg as (p: TMsg[]) => TMsg[])(prev) : arg;
  chatLive = { messages: next, uid: chatLiveUid() };
  emitLive();
}
// 流式控制（模块级，跨卸载共享：切回来的新页面操控的是同一个正在跑的流）
let liveCtrl: AbortController | null = null; // 当前请求中断器（非空即「有流在跑」）
let liveTimer: ReturnType<typeof setInterval> | null = null; // 追赶打字机
let liveBusy = false; // 是否有流在跑（驱动停止键/禁用态等 UI）
function setLiveBusy(v: boolean) { liveBusy = v; emitLive(); }

function takeChatLive() {
  if (chatLive && chatLive.uid !== "guest" && chatLive.uid !== chatLiveUid()) chatLive = null; // 换账号作废；游客→登录延续
  // 仅当确无后台流在跑（liveCtrl 为空）时，才把残留流式态归一化（防永久"思考中"）；流在跑则保留，切回接着看
  if (!liveCtrl && chatLive?.messages.some((m) => m.streaming)) chatLive = { ...chatLive, messages: normalizeMsgs(chatLive.messages) };
  return chatLive;
}

// 超长会话只渲染最近这么多条：更早的内容仍完整保留在云端与小涤的记忆（压缩摘要）里
const RENDER_WINDOW = 120;

function ChatInner() {
  const sessions = useChat((s) => s.sessions);
  const toast = useUI((s) => s.toast);
  const user = useAuth((s) => s.user);
  const authHydrated = useAuth((s) => s.hydrated); // Supabase 登录态是否已恢复完成（异步）
  const cloudLoaded = useChat((s) => s.cloudLoaded);
  // 会话消息 / busy 订阅模块级 chatLive、liveBusy（源真相在模块、跨 Tab 卸载持久）。
  // useSyncExternalStore 的服务端快照恒为 EMPTY（SSR 安全、与客户端首帧一致、不读 localStorage、不报水合错）；
  // 有历史的用户：历史由下方 useLayoutEffect 在浏览器「绘制前」直读 localStorage、经 writeLive 补上，不闪欢迎页。
  const liveSubscribe = useCallback((cb: () => void) => { liveSubs.add(cb); return () => { liveSubs.delete(cb); }; }, []);
  const messages = useSyncExternalStore(liveSubscribe, () => chatLive?.messages ?? EMPTY_MSGS, () => EMPTY_MSGS);
  const busy = useSyncExternalStore(liveSubscribe, () => liveBusy, () => false);
  const setMessages = writeLive; // 所有写都走 chatLive（源真相），再经订阅回到画面
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false); // 输入框聚焦态：驱动 placeholder 文案切换
  const [micHelpOpen, setMicHelpOpen] = useState(false); // 麦克风权限被拒引导弹窗（替代一闪而过的 toast）
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const cancelArmedRef = useRef(false);
  const voiceAborting = useRef(false); // 识别启动期间松手 → 启动完成后放弃
  // 语音输入：NEXT_PUBLIC_ASR_STREAM=1 走「实时流式」（Supabase Edge→火山，边说边出字、松手即出）；
  // 否则走「文件识别」一次性版。两个 hook 都调用（满足 hooks 规则）、按开关选其一；未选中的那个始终空闲不占麦克风。
  const STREAM_ASR = process.env.NEXT_PUBLIC_ASR_STREAM === "1";
  const _streamVoice = useStreamVoiceInput();
  const _fileVoice = useVoiceInput();
  const { voice, startVoice, stopVoice } = STREAM_ASR ? _streamVoice : _fileVoice;
  const voicePartial = STREAM_ASR ? _streamVoice.voice.partial : ""; // 流式实时识别文本（录音面板边说边显）
  const isVoiceSupported = STREAM_ASR ? streamVoiceSupported : voiceSupported;
  // 录音期间锁页面滚动：触屏上滑取消的手势若引发页面滚动，浏览器会发 pointercancel 终止手势
  useLockBodyScroll(recording);
  const [showJump, setShowJump] = useState(false); // 用户上滑回看时浮出「回到最新」
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pressFired = useRef(false); // 长按定时器是否已触发：区分「快速点按打字」与「长按语音」
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true); // 贴底跟随：用户上滑回看时停止自动滚底（流式期间被强拽回底是 P0 体验事故）
  const scrolledOnce = useRef(false); // 首次填充历史时瞬时滚到底（只做一次）
  const regenHint = useRef<string | null>(null); // 点踩后重新生成：把踩的原因喂回模型（一次性）
  const limitWarned = useRef(false); // 500 字截断只提醒一次
  const upsertSession = useChat((s) => s.upsertSession);

  // 最新消息引用：稳定回调（setFeedback 等）从这里取值。messages 已是模块派生值，直接同步即可
  const messagesRef = useRef<TMsg[]>(messages);
  messagesRef.current = messages;
  // 进入页面：清理「无流在跑」时残留的流式态（防永久"思考中"）
  useEffect(() => { takeChatLive(); emitLive(); }, []);

  // 卸载（切 Tab）：只清 UI 级短定时器；绝不中断 liveCtrl、不清 liveTimer——
  // 让流式在后台继续跑（增量实时写进模块级 chatLive、完成时由流自身落库），切回来接着看（回复到哪就是哪）
  useEffect(() => () => {
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    // 流式中切走：把当前画面（含刚发的提问）先落一次库，万一离开后硬刷新/杀进程提问不致凭空消失；
    // 绝不中断 liveCtrl——流继续后台跑，完成时会再落一次完整答案（merge-back 因 liveBusy 跳过，安全）
    if (liveBusy) persist(chatLive?.messages ?? EMPTY_MSGS);
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
      setShowJump(!at && liveBusy);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // 单一会话水合：本地 store（persist 已水合）或云端（loadCloud 完成后 sessions 更新）的 main
  // 会话灌入本页。流式中不动（防覆盖进行中对话）；只在 store 比当前画面更全时应用——
  // 覆盖三种时序：冷启动 persist 异步水合、登录后云端晚到、多设备间云端更新
  // 【绘制前·直读 localStorage】最可靠的一手：进入即同步读本地已存的 main 历史，在浏览器绘制前就补上，
  // 绕过 zustand 水合时序（订阅值/有时连 getState 在水合期都未就绪）。有历史的用户刷新/切 Tab 都直接看到
  // 对话，绝不先闪游客欢迎页再跳。仅当本地确实为空时，才落到下方「载入态 / 欢迎」判断。
  useIsoLayoutEffect(() => {
    if (liveBusy || messages.length) return;
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("ail-chat") : null;
      if (!raw) return;
      const main = JSON.parse(raw)?.state?.sessions?.find((s: { id?: string }) => s?.id === "main");
      if (main?.messages?.length) { setMessages(normalizeMsgs(main.messages)); scrolledOnce.current = false; }
    } catch {}
    // eslint-disable-next-line
  }, []);

  const mainMsgCount = sessions.find((x) => x.id === "main")?.messages.length ?? 0;
  // 云端晚到 / 多设备更新时用更全的会话刷新画面（订阅驱动）。读 getState 真实值避免水合期空快照漏判。
  useIsoLayoutEffect(() => {
    if (liveBusy) return;
    const main = useChat.getState().sessions.find((x) => x.id === "main");
    if (!main || !main.messages.length || main.messages.length <= messages.length) return;
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
    const clean = msgs.filter((m) => !m.streaming && !m.voicePending).map((m) => (m.toolNote !== undefined ? { ...m, toolNote: undefined } : m));
    if (!clean.length) return;
    // 与 store 中 main 做消息级并集（按 id 去重 + 按 id 时间戳稳定排序）后再落库：
    // busy 期间 loadCloud 返回的完整云端历史会被水合 effect 跳过（防覆盖进行中对话），
    // 流结束后若直接用页面短列表落库，会把云端几十条历史整段洗掉（P0：永久丢数据）
    const main = useChat.getState().sessions.find((x) => x.id === "main");
    let merged = clean;
    if (main?.messages.length) {
      const ids = new Set(clean.map((m) => m.id));
      // 只找回「比当前画面首条更早」的云端历史（busy 期 loadCloud 被跳过的远古段）。
      // 不找回落在画面时间区间内、id 不在画面的消息——那是用户主动删除的尾部（如「重新生成」截掉的旧问答），
      // 否则会把旧问题+被弃旧答案复活并固化云端（Bug：重新生成复活旧问答）。
      const firstT = clean.length ? msgIdTime(clean[0].id) : Infinity;
      const missing = main.messages.filter((m) => !ids.has(m.id) && msgIdTime(m.id) < firstT);
      if (missing.length) merged = [...missing, ...clean].sort((a, b) => msgIdTime(a.id) - msgIdTime(b.id));
    }
    upsertSession({ id: "main", title: MAIN_SESSION_TITLE, updatedAt: new Date().toISOString(), messages: merged });
    // 合并出了页面没有的历史：灌回页面（非 busy 时点；busy 中不会走到 merged>页面 的路径）
    if (merged.length > msgs.length && !liveBusy) {
      setMessages(normalizeMsgs(merged));
    }
  }

  // T2.1：答案来源 = 云函数 /api/chat（MiniMax 真实大模型，带多轮上下文）；
  // 拿到完整回答后仍用打字机渐显（T2.4 升级为 SSE 真流式）。
  // voiceId：语音输入路径——本次提问由已存在的「…」占位用户气泡承载（填入识别文字、不新建用户消息）；
  // 该路径在占位期间 busyRef 已为 true，故跳过 busyRef 闸（其余流式逻辑与普通发送完全一致）
  function send(text: string, base?: TMsg[], voiceId?: string) {
    const q = text.trim();
    if (!q || (!voiceId && liveBusy)) return;
    liveBusy = true;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto"; // 多行输入框复位
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } // 兜底清残留打字机
    stick.current = true; // 发新问题必然想看回答：恢复贴底跟随
    // 消息 id 时间戳单调化：persist 合并按 msgIdTime 排序，本机时钟回拨/多端钟差时
    // 新消息若拿到更小时间戳会被排进历史中部（页面追加序与落库序分叉）
    const baseMsgs = base ?? messages;
    const lastT = baseMsgs.reduce((mx, m) => Math.max(mx, msgIdTime(m.id)), 0);
    const n = `${Math.max(Date.now(), lastT + 1)}-${seq.current++}`;
    const aId = "a" + n;
    const aMsg: TMsg = { id: aId, role: "assistant", content: "", streaming: true };
    // base：重新生成时传入「已截掉旧回答」的消息列表，避免旧渲染闭包把被删的回答又拼进上下文（模型会被旧答案锚定而复读）
    // 错误/中断占位消息（error 标记）不进上下文；卡片占位标记也必须剥掉：模型看到 [[recs:0,2]] 会模仿着往回答里写
    let history: { role: string; content: string }[];
    if (voiceId) {
      // 占位气泡已在 baseMsgs 中：把它的内容映射成识别文字 q 进上下文，并就地填字 + 追加助手气泡（不新建用户消息，无闪烁）
      history = baseMsgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: stripCardMarkers(m.id === voiceId ? q : m.content) }));
      setMessages((prev) => prev.map((m) => (m.id === voiceId ? { ...m, content: q, voicePending: false } : m)).concat(aMsg));
    } else {
      const userMsg: TMsg = { id: "u" + n, role: "user", content: q };
      history = [...baseMsgs, userMsg].filter((m) => !m.error).map((m) => ({ role: m.role, content: stripCardMarkers(m.content) }));
      setMessages((prev) => [...prev, userMsg, aMsg]);
    }
    // 点踩后重新生成：把踩的原因作为一次性指示喂给模型（不渲染、不落库），反馈当场可感知地生效
    if (regenHint.current) {
      history.splice(history.length - 1, 0, { role: "user", content: `（说明：你上一条回答被我标记了「${regenHint.current}」，请换个角度重新回答，不要重复原来的说法）` });
      regenHint.current = null;
    }
    setLiveBusy(true);

    const ctrl = new AbortController();
    liveCtrl = ctrl;
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
          if (liveTimer) return;
          liveTimer = setInterval(() => {
            if (liveCtrl !== ctrl && !ended) return; // stop() 已接管收尾
            if (shown < acc.length) {
              // 后台标签页 interval 被节流到约 1Hz，追赶公式在 1Hz 下追完长回答要几十秒——
              // 不可见时直接全量上屏，切回来即是完整回答而不是"还在慢慢爬"
              if (document.hidden) shown = acc.length;
              else shown = Math.min(acc.length, shown + Math.max(2, Math.ceil((acc.length - shown) / 25)));
              for (const [s, e] of markerSpans) if (shown > s && shown < e) shown = e; // 不停在标记中间
              apply({ content: acc.slice(0, shown) }); // 不动 toolNote：工具状态由事件自己管理
            } else if (ended) {
              if (liveTimer) clearInterval(liveTimer);
              liveTimer = null;
              // 流正常 end 但全程零文字零卡片（如 max_tokens 烧尽在思考段）：给错误占位而非空气泡
              if (!acc.trim() && !recsAcc.length && !citesAcc.length && !webAcc.length) {
                apply({ content: "这次没说出话来，点「重新生成」再试一次吧", streaming: false, toolNote: undefined, error: true });
              } else {
                apply({ content: acc, streaming: false, toolNote: undefined });
              }
              setLiveBusy(false);
              persist(chatLive?.messages ?? EMPTY_MSGS); // 卸载后 busy 边沿 effect 不触发：流自己落库（切走后台完成也存）
              setShowJump(false);
            }
          }, 16);
        };
        // 事件去重再 apply：每个 delta 都清一次 toolNote / 同值 status 重复写，都会给目标消息
        // 换引用触发整列表 setMessages——只有真的变化才动状态
        let noteShown: string | undefined;
        const handle = async (ev: { t: string; v?: unknown }) => {
          if (liveCtrl !== ctrl) return; // 停止/被新请求取代后不再消费缓冲区残留事件（防 await 窗口期复活僵尸打字机）
          if (ev.t === "d" && typeof ev.v === "string") {
            acc += ev.v;
            if (noteShown !== undefined) { noteShown = undefined; apply({ toolNote: undefined }); } // 新文字到达才清工具状态
            smooth();
          }
          else if (ev.t === "status" && typeof ev.v === "string") { if (noteShown !== ev.v) { noteShown = ev.v; apply({ toolNote: ev.v }); } }
          else if (ev.t === "recs" && Array.isArray(ev.v)) {
            // 事件直带 id/title/author/封面种子(cs)/封面图(cv)，前端零查询直接成完整卡片——
            // 彻底消除"降级空封面"与 getBook 富化竞态（Bug#2）。标记位置由当下 acc 决定，顺序不漂移。
            const cards: Book[] = (ev.v as { id: string; title?: string; author?: string; cv?: string; cs?: number }[])
              .filter((it) => it && it.id)
              .map((it) => ({
                id: it.id, title: it.title ?? "", author: it.author ?? "", cover: it.cv ?? "", coverSeed: it.cs ?? 1,
                heroUrl: "", posterUrl: "", category: "", categoryId: "", tags: [], summary: "", rating: 0, readers: 0,
                words: 0, durationMin: 0, hasVideo: false, hasAudio: false, hasText: false, likes: 0, favCount: 0,
                reviewCount: 0, featured: false, intro: "", shelvedAt: "",
              } as Book));
            if (cards.length) {
              const from = recsAcc.length;
              recsAcc.push(...cards);
              pushMarker("recs", from, recsAcc.length);
              apply({ recommendations: recsAcc.slice() });
              smooth();
            }
          } else if (ev.t === "cites" && Array.isArray(ev.v)) {
            const cites = await buildCitations(ev.v as { b: string; c: number }[]);
            if (liveCtrl !== ctrl) return; // await 期间被停止：同上
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
        if (liveCtrl !== ctrl) return; // 已被停止/新请求取代
        liveCtrl = null;
        ended = true;
        smooth(); // 流结束：让打字机追完剩余文字后收尾（若无任何增量也会直接收尾）
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return; // 卸载/停止导致的中断不是错误
        if (liveCtrl !== ctrl) return; // 用户主动停止，stop() 已收尾
        liveCtrl = null;
        // 必须清掉打字机 interval：否则残留空转的旧 interval 会让下一次提问永远渲染不出字（P0）
        if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
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
        setLiveBusy(false);
        persist(chatLive?.messages ?? EMPTY_MSGS); // 卸载后也落库：保留已流出的正文/错误占位
      });
  }

  function stop() {
    if (liveCtrl) { liveCtrl.abort(); liveCtrl = null; }
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; } // 必须置 null：陈旧 id 残留会让下次 smooth() 误判"已有打字机"
    // 卡片数据在事件到达时已挂上消息：内容里有标记按标记位置渲染，标记没吐到则回退末尾渲染，不会丢卡
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.streaming) return m;
        return m.content
          ? { ...m, streaming: false, toolNote: undefined }
          : { ...m, content: "好，先停在这里。想继续随时叫我", streaming: false, toolNote: undefined, error: true };
      })
    );
    liveBusy = false;
    setLiveBusy(false);
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

  // useCallback 固化为稳定引用（取值走 messagesRef.current + 模块级 liveBusy）：否则每次按键重渲染都换新引用，
  // 作为 onRegenerate 传给"最后一条助手消息"会让它 memo 失效、逐字打字时整段重解析 ReactMarkdown（卡顿）。
  const regenerate = useCallback(() => {
    if (liveBusy) return;
    const msgs = messagesRef.current;
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx < 0) return;
    const q = msgs[lastUserIdx].content;
    // 被重新生成的回答若被踩过，把原因一次性喂回模型（反馈闭环：用户当场看到"它听进去了"）
    const replaced = msgs[lastUserIdx + 1];
    if (replaced?.feedback === "down") {
      regenHint.current = replaced.feedbackReasons?.length ? replaced.feedbackReasons.join("、") : "不满意";
    }
    const base = msgs.slice(0, lastUserIdx); // 显式传给 send：旧闭包里的 messages 还带着被删的回答
    setMessages(base);
    setTimeout(() => send(q, base), 30);
    // eslint-disable-next-line
  }, []);

  // 语音输入（T6）：长按输入框说话 → 松开识别文本回填输入框 → 上滑取消。
  // 识别走浏览器原生 SpeechRecognition（MiniMax 无 ASR，决策见 evidence/T6）；不支持的环境降级提示
  function setRec(v: boolean) { recordingRef.current = v; setRecording(v); }
  function onRecPointerMove(e: React.PointerEvent) {
    if (!recordingRef.current || !pressStart.current) return;
    const armed = pressStart.current.y - e.clientY > 60; // 上滑超过 60px 进入「取消」态（更灵敏）
    cancelArmedRef.current = armed;
    setCancelArmed(armed);
  }
  async function endRecording() {
    if (!recordingRef.current) return;
    setRec(false);
    // 语音结束（发送 / 取消 / 失败）后保持输入框未聚焦：不回弹软键盘，体验与「按住说话」按钮一致
    requestAnimationFrame(() => inputRef.current?.blur());
    const canceled = cancelArmedRef.current;
    cancelArmedRef.current = false;
    setCancelArmed(false);
    if (canceled) { stopVoice(true); return; } // 取消：丢弃、不识别、不弹 toast
    if (liveBusy) { stopVoice(true); toast("小涤还在回话，等它说完再聊语音哦", "info"); return; } // 生成中不接语音，避免占位/流式打架

    // 去掉「识别中」面板：松手即在聊天区放一条「…」占位用户气泡，识别完替换成语音文字再触发回答
    const cur = messages;
    const lastT = cur.reduce((mx, m) => Math.max(mx, msgIdTime(m.id)), 0);
    const vId = "u" + `${Math.max(Date.now(), lastT + 1)}-${seq.current++}`;
    liveBusy = true; // 占位期间挡住其它发送（send 的 voiceId 路径会重新置位）
    stick.current = true;
    setMessages((prev) => [...prev, { id: vId, role: "user", content: "", voicePending: true }]);

    const { text, fatal, error } = await stopVoice(false);
    liveBusy = false; // 解除占位闸，交给 send 接管
    if (text) {
      const q = (input.trim() ? `${input.trim()} ${text}` : text).slice(0, 500);
      // base 用「占位前 messages + 占位气泡」：闭包 messages 不含占位，补上即当前真态；send 按 voiceId 把它的内容映射成 q
      send(q, [...cur, { id: vId, role: "user", content: "" }], vId);
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== vId)); // 失败：撤掉占位气泡
      if (fatal) setMicHelpOpen(true);
      else if (error) toast("识别没成功，网络不太顺，再试一次或打字告诉我", "info");
      else toast("没听清，再试一次或打字告诉我", "info");
    }
  }
  function onInputPointerDown(e: React.PointerEvent) {
    // 注意：模型回话中（busy）也不能在这里直接 return——否则会跳过下面的 preventDefault，
    // 浏览器就对 textarea 走默认长按行为（聚焦 + 弹「粘贴/全选」菜单），正是"按住说话变成输入框"的根因。
    // 改为照常 preventDefault 接管手势，到 350ms 真要起语音时再用 liveBusy 拦下、给温和提示。
    // 录音中/长按窗口内第二根手指（掌缘误触）再落下：忽略——否则两个定时器都会触发 startVoice，
    // 双识别器并存会清掉已识别文本且旧识别器占着麦克风不放
    if (recordingRef.current || pressTimer.current) return;
    // 仅在输入框未聚焦时，长按才触发语音；已在编辑文本时长按交给浏览器（选字/移动光标等）
    if (document.activeElement === inputRef.current) return;
    // 未聚焦时按下：阻止 textarea 自动聚焦——否则长按语音前会先弹一下软键盘再收起（用户反馈：体验差）。
    // 想打字的「快速点按」场景，在 pointerup（onInputPointerUp）里手动聚焦补回。
    e.preventDefault();
    pressFired.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    // 指针捕获：录音浮层渲染后会遮住输入框，没有 capture 时鼠标指针被判定"离开"输入框 →
    // pointerleave → endRecording → 浮层一出现就自杀。capture 后事件全程派给输入框，遮挡无影响
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    pressTimer.current = setTimeout(async () => {
      pressFired.current = true;
      // 模型还在回话时长按：不进语音（识别完会自动发送，与正在流式的回答冲突），给温和提示即可。
      // 取 liveBusy 实时值（而非闭包捕获的 busy）：模型若在按住期间刚好答完，仍可顺畅进入语音。
      if (liveBusy) { toast("小涤还在回话，等它说完再聊语音哦~", "info"); return; }
      if (recordingRef.current) return; // 竞态兜底：已在录音绝不再起一个识别器
      if (!isVoiceSupported()) {
        toast("当前浏览器不支持语音输入，可以用键盘自带的语音键", "info");
        return;
      }
      voiceAborting.current = false;
      inputRef.current?.blur();
      const okStart = await startVoice();
      if (!okStart) {
        // 权限被拒 / 无麦克风：弹可操作的引导弹窗，而非一闪而过的 toast（之后每次长按都会再弹，直到用户去设置里放开）
        setMicHelpOpen(true);
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
  // 真正松手（pointerup，区别于 pointerleave）：快速点按（没触发长按语音、也没在录音）→ 手动聚焦进入打字
  // （pointerdown 已 preventDefault 阻止自动聚焦防键盘闪现，这里在用户手势内补回聚焦，正常弹起键盘）。
  function onInputPointerUp() {
    const quickTap = !pressFired.current && !recordingRef.current;
    onInputPointerEnd();
    if (quickTap && inputRef.current) {
      // 进入打字：按钮态时 textarea 是只读的（触摸不弹键盘），先解除只读、再在用户手势内聚焦，正常弹出键盘。
      // 解除后 onFocus 会置 inputFocused=true，下一次渲染 readOnly 同样为 false，与此处一致、不会回弹。
      inputRef.current.readOnly = false;
      inputRef.current.focus();
    }
  }
  // 触屏滚动等系统手势抢占（pointercancel）：一律按"取消"处理——此时用户多半在上滑，
  // 若当作"确认松手"会把半截话回填进输入框，与取消意图正好相反
  function onInputPointerCancel() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (recordingRef.current) {
      setRec(false);
      requestAnimationFrame(() => inputRef.current?.blur()); // 系统手势取消语音后同样保持失焦
      stopVoice(true);
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
  // 仅当「登录态已确定(authHydrated)」后才显示欢迎页：否则登录用户在登录态异步恢复完成前，会先闪一下
  // 「游客版欢迎(去登录)」再跳历史。登录用户历史由上面 layout effect 直读 localStorage / loadCloud 补上；
  // 云端拉回前先显载入态、不显欢迎。游客(authHydrated 后 user 仍空)正常显示游客欢迎。
  const showWelcome = empty && authHydrated && (!user || cloudLoaded === user.id);
  // 超长会话只渲染窗口内的消息；regenerate/反馈按原数组索引判定不受影响
  const visible = messages.slice(-RENDER_WINDOW);
  const hiddenCount = messages.length - visible.length;

  return (
    // 全部底部锚定都要计入 env(safe-area-inset-bottom)：BottomNav 实际高度=58px+inset，
    // 固定 58px 会让输入条在 iOS PWA/手势导航机型上与导航条重叠、下沿被盖住误触 Tab
    <main className="min-h-[100dvh] pb-[calc(150px+env(safe-area-inset-bottom))]">
      <div className="px-4 pt-[calc(env(safe-area-inset-top)+10px)]">
        {empty ? (
          showWelcome ? (
            <Welcome onAsk={send} />
          ) : (
            <div className="flex justify-center pt-24 text-sm text-ink-300 dark:text-dark-text/50">正在载入对话…</div>
          )
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
      {/* 落到 bottom-0、底部留出 Tab 高度的内边距：输入框本体顶到 Tab 之上，同时背景一路铺到屏底，
          彻底填掉「输入框↔Tab」之间会露出聊天文字的缝（不依赖固定 58px 精确贴合） */}
      <div className="app-width fixed bottom-0 left-1/2 z-40 -translate-x-1/2 bg-moon/95 px-3 pt-3 pb-[calc(58px+env(safe-area-inset-bottom)+12px)] backdrop-blur dark:bg-dark-bg/95">
        {input.length >= 450 && (
          <p className={"mb-1 pr-1 text-right text-[11px] " + (input.length >= 500 ? "text-rouge" : "text-ink-300")}>{input.length}/500</p>
        )}
        <div className="flex items-center gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={onInputChange}
            // 按压/录音期间即便有焦点滑入也不进「聚焦态」：避免只读翻可编辑、placeholder 闪动；正常点按打字才置 true
            onFocus={() => { if (!pressTimer.current && !recordingRef.current) setInputFocused(true); }}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              // isComposing：输入法候选未上屏时按 Enter 是"选词"，不能把半截拼音发出去
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
            }}
            onPointerDown={onInputPointerDown}
            onPointerUp={onInputPointerUp}
            onPointerLeave={onInputPointerEnd}
            onPointerCancel={onInputPointerCancel}
            onPointerMove={onInputPointerMove}
            // 长按说话期间，输入框是「按住说话」按钮而非编辑区：拦掉系统「选字/粘贴」右键菜单，
            // 否则录音/识别时屏幕底部会冒出原生「粘贴」气泡（浮在遮罩之上，DOM z-index 盖不住）。
            // 仅在按压/录音/识别态拦截；正常聚焦打字时放行（长按粘贴照常可用）。
            onContextMenu={(e) => { if (recordingRef.current || pressTimer.current || voice.transcribing) e.preventDefault(); }}
            // 只读时机：① 录音/识别中（消除原生光标/选区手柄）；② **未聚焦的「按住说话」按钮态**——
            // 只读 textarea 被触摸/聚焦时不会弹软键盘，这样长按语音前绝不会先闪一下键盘（preventDefault 在个别
            // webview 拦不住聚焦，单靠它不保险；只读是兜底根治）。点按打字时由 onInputPointerUp 解除只读并聚焦。
            readOnly={recording || voice.transcribing || !inputFocused}
            rows={1}
            placeholder={inputFocused ? "发消息…" : "发消息或按住说话…"}
            // 未聚焦（即作为「按住说话」按钮时）禁用文字选区 + iOS 长按气泡，根除选区手柄；聚焦编辑时不受影响
            className="max-h-24 flex-1 resize-none touch-none rounded-2xl border border-line bg-snow px-4 py-2.5 text-sm text-ink outline-none [-webkit-touch-callout:none] [&:not(:focus)]:select-none [&:not(:focus)]:[-webkit-user-select:none] focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text dark:placeholder:text-dark-text/40"
          />
          {/* 生成中：发送图标变「停止」实心方块，点击即停止生成；空闲：正常发送（无内容禁用） */}
          <button
            onClick={busy ? stop : () => send(input)}
            disabled={!busy && !input.trim()}
            aria-label={busy ? "停止生成" : "发送"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-celadon text-snow disabled:opacity-40 active:scale-95"
          >
            {busy ? <span className="h-3.5 w-3.5 rounded-[3px] bg-snow" /> : <Send size={18} />}
          </button>
        </div>
      </div>

      {/* 麦克风权限引导弹窗：被拒后每次长按都弹此可操作提示（替代一闪而过的 toast），引导去设置放开后再用 */}
      {micHelpOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 px-8 backdrop-blur-sm dark:bg-black/50" onClick={() => setMicHelpOpen(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-snow p-5 text-center shadow-xl dark:bg-dark-card" onClick={(e) => e.stopPropagation()}>
            <p className="font-serif text-base text-ink dark:text-dark-text">开启麦克风才能语音输入</p>
            <p className="mt-2.5 text-xs leading-relaxed text-ink-500 dark:text-dark-text/60">
              麦克风权限被拒绝了。请在浏览器地址栏的 🔒 处，或手机「设置 → 应用权限」里允许本站使用麦克风，再长按输入框说话；也可以直接打字告诉我。
            </p>
            <button onClick={() => setMicHelpOpen(false)} className="mt-4 h-9 w-full rounded-full bg-celadon text-sm text-snow active:scale-95">我知道了</button>
          </div>
        </div>
      )}

      {/* 录音面板（严格参考豆包：白底面板，上→下＝声纹 / 灰提示 / 大长框「按住说话处」；
          长框下方用白底盖住底部 Tab，浑然一体）。整屏不遮挡聊天内容；声纹+长框 青瓷↔胭脂 随上滑切换。
          手势由输入框指针捕获驱动，本面板 onPointerMove/Up 作无捕获兜底；松手后原地转「识别中」 */}
      {recording && (
        <div
          role="alertdialog"
          aria-label="语音输入中"
          onPointerMove={onRecPointerMove}
          onPointerUp={endRecording}
          className="app-width fixed bottom-0 left-1/2 z-[60] -translate-x-1/2 animate-fade-up bg-moon px-4 pt-6 pb-[calc(58px+env(safe-area-inset-bottom))] dark:bg-dark-bg"
        >
          <div className="flex flex-col items-center gap-4">
            {/* 声纹（更宽更大气：粗柱 5px + 拉开间距 + 加高）；青瓷↔胭脂随上滑切换，近静音匀速呼吸回退 */}
            <div className="flex h-10 items-center justify-center gap-[6px]" aria-hidden>
              {[0.3, 0.42, 0.54, 0.66, 0.78, 0.88, 0.95, 0.99, 1, 0.99, 0.95, 0.88, 0.78, 0.66, 0.54, 0.42, 0.3].map((k, i) =>
                voice.level > 0.04 ? (
                  <span
                    key={i}
                    className={"w-[5px] rounded-full transition-[height,background-color] duration-100 " + (cancelArmed ? "bg-rouge" : "bg-celadon")}
                    style={{ height: `${Math.round(5 + k * voice.level * 30)}px` }}
                  />
                ) : (
                  <span key={i} className={"voice-bar w-[5px] rounded-full " + (cancelArmed ? "bg-rouge/80" : "bg-celadon/75")} style={{ animationDelay: `${i * 0.06}s` }} />
                )
              )}
            </div>
            {/* 实时识别文字（流式版边说边显）：识别到内容即显示在波形下方 */}
            {STREAM_ASR && voicePartial ? (
              <p className="max-h-16 w-full overflow-hidden px-2 text-center text-sm leading-relaxed text-ink dark:text-dark-text">{voicePartial}</p>
            ) : null}
            {/* 灰色提示（常驻不变色） */}
            <p className="text-xs text-ink-400 dark:text-dark-text/55">{cancelArmed ? "松开取消" : "上滑取消，松开发送"}</p>
            {/* 大号长框＝手指长按处：青瓷↔上滑变红；下方实色盖住 Tab、一体化 */}
            <div className={"h-14 w-full rounded-3xl shadow-celadon transition-colors duration-200 " + (cancelArmed ? "bg-rouge" : "bg-celadon")} />
          </div>
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

  const cats = home.data?.categories ?? [];
  // 随机示例问题须 memo：否则每次重渲染(打字等)都重新随机会闪动；按数据变化才重算（每次进来稳定一份新的）
  const questions = useMemo(
    () =>
      user
        ? buildQuestions({ history, progress, favorites, notes, books, categories: cats })
        : buildGuestQuestions(books, cats),
    // eslint-disable-next-line
    [user, books, cats, history, progress, favorites, notes]
  );

  // 开场白素材：最近接触的一本书
  const last = history[0];
  const hours = readSeconds >= 3600 ? `${(readSeconds / 3600).toFixed(1)} 小时` : `${Math.max(1, Math.round(readSeconds / 60))} 分钟`;

  return (
    <div className="relative flex flex-col items-center pt-8">
      <Motif name="bamboo" className="pointer-events-none absolute -top-2 right-0 h-20 w-20 text-celadon/30" />
      <Mascot size={84} className="shadow-celadon" />
      {user ? (
        <>
          <p className="mt-4 text-center font-serif text-xl text-ink dark:text-dark-text">AI 读书伙伴 ~ 小涤</p>
          <p className="mt-1 text-center text-xs text-ink-300">通览馆藏，为你荐书 · 答疑 · 解读原文</p>
        </>
      ) : (
        <>
          <p className="mt-4 text-center font-serif text-xl text-ink dark:text-dark-text">AI 读书伙伴 ~ 小涤</p>
          <p className="mt-1 text-center text-xs text-ink-300">通览馆藏，为你荐书 · 答疑 · 解读原文</p>
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
