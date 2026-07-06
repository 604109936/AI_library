"use client";
import { memo, useState, useEffect } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { ThumbsUp, ThumbsDown, Copy, RotateCw, Pencil, ExternalLink, ChevronDown, ChevronRight, Globe, Sparkles, BookOpen } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { ShimmerText } from "@/components/chat/ShimmerText";
import { splitCardSegments, stripCardMarkers } from "@/lib/chatMarkers";
import { useUI } from "@/lib/store";
import type { Book, Citation, WebSource, ChatMessage as TMsg } from "@/lib/types";

// 反馈标签（对齐补充文档：推荐偏差 / 答疑有误 / 解读没用 / 其它，「其它」可个性化输入）
const FEEDBACK = ["推荐偏差", "答疑有误", "解读没用", "其它"];

// 纯思考态的递进文案：按思考已持续时长，从「思考中」逐段推进到「用心作答」后停住（不循环）。
// 顺着小涤组织回答的过程，越等越显"在认真作答"。真内容/工具状态一出现即被父级切走（随时打断）。
const THINK_HINTS = ["思考中", "梳理思路", "组织语言", "用心作答"];
const THINK_STEPS_MS = [4000, 9000, 15000]; // 进入第 2/3/4 段的时延阈值
function ThinkingHints() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const ts = THINK_STEPS_MS.map((ms, idx) => setTimeout(() => setI(idx + 1), ms));
    return () => ts.forEach(clearTimeout);
  }, []);
  return <ShimmerText text={THINK_HINTS[i]} />;
}

// 等待文案：有工具状态（override，如「查找书籍」「联网搜索」）就显示它；纯思考态走 4 段递进 think hint。
function ThinkingNote({ override }: { override?: string }) {
  return override ? <ShimmerText text={override} /> : <ThinkingHints />;
}

// 流式卡顿指示：打字机追平模型、上游出字停顿(火山token间歇/网络抖动)时，正文会冻住让用户以为断线。
// 文字停止前进 >1.8s 才浮现三个呼吸点（正常流畅出字时零打扰），一恢复出字立刻消失。
function useStalled(content: string, streaming: boolean) {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!streaming || !content.trim()) { setStalled(false); return; }
    setStalled(false);
    const t = setTimeout(() => setStalled(true), 1800);
    return () => clearTimeout(t);
  }, [content, streaming]);
  return stalled;
}
function StallDots() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 align-baseline animate-fade-up" aria-label="小涤在斟酌">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-300/70 dark:bg-dark-text/40" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

// CJK 加粗渲染兜底：CommonMark 边界规则下，** 紧贴中文标点(《 " 「 等)时加粗不成立、星号裸露（实锤图三处）。
// 提示词治不了 100%——渲染前只在「必定渲染失败」的位置按需插入极细空格(U+2009，视觉几乎不可见)，正常加粗零影响。
const BOLD_PUNCT = "\u300a\u300b\u300c\u300d\u300e\u300f\u3010\u3011\u3008\u3009\uff08\uff09()[]{}\"'\u201c\u201d\u2018\u2019\u3001\u3002\uff0c,.\uff1a:\uff1b;\uff01!\uff1f?\u2026\u2014\uff5e~\u00b7-";
const isBoldPunct = (ch: string) => !!ch && BOLD_PUNCT.indexOf(ch) >= 0;
const isWsCh = (ch: string) => !!ch && /\s/.test(ch);
function fixCjkBold(md: string): string {
  return md.replace(/\*\*([^*\n]+?)\*\*/g, (m, inner: string, off: number, str: string) => {
    const prev = off > 0 ? str[off - 1] : "";
    const next = str.charAt(off + m.length);
    const needPre = isBoldPunct(inner[0]) && !!prev && !isWsCh(prev) && !isBoldPunct(prev); // ** 后是标点且前面是文字 → 开界必失败
    const needPost = isBoldPunct(inner[inner.length - 1]) && !!next && !isWsCh(next) && !isBoldPunct(next); // ** 前是标点且后面是文字 → 闭界必失败
    return (needPre ? "\u2009" : "") + m + (needPost ? "\u2009" : "");
  });
}

// 表格在手机气泡里必然挤爆（用户明确不要表格）：System 已禁止小涤输出表格，
// 这里再做渲染兜底——万一漏出表格语法，降级为紧凑的行式列表而非 <table>
const MD_COMPONENTS: Components = {
  // 联网搜索（T10）后正文出现链接是常态：默认 <a> 无样式不可发现、同页跳转会把整段会话画面替换掉。
  // 新开页 + 青瓷色下划线，与 WebBlock 来源卡的外链行为对齐（危险协议由 react-markdown 默认 urlTransform 过滤）
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-celadon-700 underline decoration-celadon/40 underline-offset-2 dark:text-celadon-300">
      {children}
    </a>
  ),
  table: ({ children }) => <div className="my-2 space-y-1.5 text-sm">{children}</div>,
  thead: ({ children }) => <div className="pb-1 font-medium text-ink dark:text-dark-text">{children}</div>,
  tbody: ({ children }) => <div className="space-y-1.5">{children}</div>,
  tr: ({ children }) => <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">{children}</div>,
  th: ({ children }) => <span className="font-medium">{children}</span>,
  td: ({ children }) => <span className="text-ink-700 dark:text-dark-text/80">{children}</span>,
};

/* 推荐书目卡组：封面叠"懂你"徽标（已读完 / 在读 N% / 在书架）。
   交错渲染后卡组出现在工具调用的真实位置（理由之后、后话之前），fade-up 让它"亮相"而非"闪现" */
function RecsBlock({ books }: { books: Book[] }) {
  return (
    <div className="my-3 animate-fade-up first:mt-0 last:mb-0">
      {/* 系统标签样式：青瓷色 + 图标 + 小字距，与 AI 正文(墨色 prose)明确区分，不让用户误读成对话文字 */}
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles size={13} className="shrink-0 text-celadon" />
        <span className="text-[11px] font-medium tracking-[0.08em] text-celadon-700 dark:text-celadon-300">为你挑的书</span>
      </div>
      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 no-scrollbar">
        {books.map((b) => (
          <Link key={b.id} href={`/library/book/${b.id}`} className="w-[88px] shrink-0">
            <BookCover title={b.title} seed={b.coverSeed} src={b.cover} className="w-[88px]" showText={false} />
            {/* 书名/作者左右居中；不再显示任何阅读状态徽标（音视频/文字稿两套进度，标"在读"会歧义·用户口径） */}
            <p className="mt-1.5 truncate text-center text-xs text-ink dark:text-dark-text">{b.title}</p>
            <p className="truncate text-center text-[10px] text-ink-300">{b.author}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* 引用章节卡组：列出答疑/解读所依据的章节，点击直达原文（不再标注个人阅读进度·用户口径） */
function CitesBlock({ cites }: { cites: Citation[] }) {
  return (
    <div className="my-3 animate-fade-up space-y-2 first:mt-0 last:mb-0">
      {/* 系统标签样式：图标 + 青瓷色 + 小字距，与「为你挑的书」一致，区别于 AI 正文 */}
      <div className="flex items-center gap-1.5">
        <BookOpen size={13} className="shrink-0 text-celadon" />
        <span className="text-[11px] font-medium tracking-[0.08em] text-celadon-700 dark:text-celadon-300">引用 {cites.length} 章 · 点开读原文</span>
      </div>
      {cites.map((c, i) => (
        <Link
          key={i}
          href={`/library/book/${c.bookId}/read?ch=${c.bookId}-c${c.chapterNo}`}
          className="flex items-center gap-2.5 rounded-xl border border-line p-2.5 transition active:bg-moon/50 dark:border-white/10 dark:active:bg-white/5"
        >
          <BookCover title={c.bookTitle} seed={c.coverSeed} src={c.cover} className="w-9 shrink-0" showText={false} />
          <div className="min-w-0 flex-1">
            {/* 前言=第0章：不标「第0章」前缀（突兀），直接显章题（如「前言」）；正文章节才显「第N章 标题」 */}
            <p className="truncate text-xs font-medium text-ink dark:text-dark-text">《{c.bookTitle}》{c.chapterNo === 0 ? c.chapterTitle : `第${c.chapterNo}章 ${c.chapterTitle}`}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-500 dark:text-dark-text/55">{c.snippet}</p>
          </div>
          {/* 跳转箭头：明确"可点击直达原文"的交互信号 */}
          <ChevronRight size={16} className="shrink-0 text-ink-300 dark:text-dark-text/40" />
        </Link>
      ))}
    </div>
  );
}

/* 单条来源链接（域名 + 日期给可信度参照；不渲染 snippet，来源卡只管溯源） */
function SourceLink({ s, n, locked, onLocked }: { s: WebSource; n: number; locked?: boolean; onLocked?: () => void }) {
  let host = "";
  let safe = false;
  try {
    const u = new URL(s.u);
    host = u.hostname.replace(/^www\./, "");
    safe = u.protocol === "http:" || u.protocol === "https:";
  } catch {}
  if (!safe) return <div className="rounded-xl border border-line p-2.5 text-xs text-ink-500 dark:border-white/10 dark:text-dark-text/55">{s.t}</div>;
  // 生成中「可看不可跳」：半透明+无外链箭头(状态自明)，点击给轻提示——从源头掐掉"生成中跳走导致断线"的最高发入口；
  // 回答写完自动恢复可点。信息不藏(标题可浏览)，只限制跳出动作。
  if (locked) {
    return (
      <button type="button" onClick={onLocked} className="flex w-full items-center gap-2 rounded-xl border border-line p-2.5 text-left opacity-60 dark:border-white/10">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-celadon-soft text-[11px] font-medium text-celadon-700 dark:bg-celadon/15 dark:text-celadon-300">{n}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink dark:text-dark-text">{s.t}</p>
          <p className="mt-0.5 truncate text-[10px] text-ink-300">{host}{s.d ? ` · ${s.d}` : ""}</p>
        </div>
      </button>
    );
  }
  return (
    <a href={s.u} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-line p-2.5 active:bg-moon/50 dark:border-white/10 dark:active:bg-white/5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-celadon-soft text-[11px] font-medium text-celadon-700 dark:bg-celadon/15 dark:text-celadon-300">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink dark:text-dark-text">{s.t}</p>
        <p className="mt-0.5 truncate text-[10px] text-ink-300">{host}{s.d ? ` · ${s.d}` : ""}</p>
      </div>
      <ExternalLink size={13} className="shrink-0 text-ink-300" />
    </a>
  );
}

/* 联网来源卡组（T10，豆包式聚合）：一次回答里所有联网搜索合并为一张卡，按搜索词分组。
   卡头：单关键词→「联网搜索「<词>」」；多关键词→「搜索 N 个关键词」；恒带「· 参考 M 篇资料」。
   展开：多关键词时每组顶上标出搜索词，组内来源各自编号——用户一眼知道哪批资料来自哪个搜索词。 */
function WebBlock({ sources, locked }: { sources: WebSource[]; locked?: boolean }) {
  const [open, setOpen] = useState(false); // 默认折叠（参考豆包）
  const toast = useUI((st) => st.toast);
  const onLocked = () => toast("先让小涤把话说完，资料马上就能看", "info");
  // 按搜索词分组，保留出现顺序
  const groups: { q: string; items: WebSource[] }[] = [];
  for (const s of sources) {
    const q = s.q || "";
    const g = groups.find((x) => x.q === q);
    if (g) g.items.push(s);
    else groups.push({ q, items: [s] });
  }
  const kws = groups.map((g) => g.q).filter(Boolean);
  const nKw = kws.length;
  const trunc = (t: string) => (t.length > 14 ? t.slice(0, 14) + "…" : t);
  return (
    <div className="my-3 animate-fade-up first:mt-0 last:mb-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-xl border border-line bg-snow/60 px-3 py-2 text-xs text-ink-500 active:bg-moon/50 dark:border-white/10 dark:bg-white/5 dark:text-dark-text/60 dark:active:bg-white/10"
      >
        <Globe size={13} className="shrink-0 text-celadon" />
        <span className="truncate">
          {nKw > 1 ? (
            `搜索 ${nKw} 个关键词`
          ) : nKw === 1 ? (
            <>联网搜索<span className="text-celadon-700 dark:text-celadon-300">「{trunc(kws[0])}」</span></>
          ) : (
            "联网搜索"
          )}
          <span className="text-ink-400 dark:text-dark-text/45"> · 参考 {sources.length} 篇资料</span>
        </span>
        <ChevronDown size={14} className={"ml-auto shrink-0 text-ink-300 transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {groups.map((g, gi) => (
            <div key={gi} className="space-y-2">
              {/* 多关键词时每组顶上标出搜索词（单关键词已在卡头标出，不重复） */}
              {nKw > 1 && g.q && <p className="px-1 text-xs text-celadon-700 dark:text-celadon-300">“{g.q}”</p>}
              {g.items.map((s, i) => <SourceLink key={i} s={s} n={i + 1} locked={locked} onLocked={onLocked} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 语音占位「…」：三个跳动点（与气泡同青瓷色系），识别完即被语音文字替换
function VoiceDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="识别中">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-celadon-700 dark:bg-celadon-300" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

// memo：打字机 16ms 一拍 setMessages 时只有目标消息换了引用，其余（最多 120 条）跳过
// ReactMarkdown 全量重解析——长会话流式/录音音量刷新下的卡顿大头。
// 回调按 (id, …) 签名设计且必须由父组件以稳定引用传入：内联箭头函数会让浅比较永远失败、memo 形同虚设
export const ChatMessage = memo(function ChatMessage({
  msg,
  onRegenerate,
  onContinue,
  onSuggest,
  onFeedback,
  onFeedbackDetail,
}: {
  msg: TMsg;
  onRegenerate?: () => void;
  onContinue?: () => void; // 截断回答专用：从断点续写（替代「重新生成」）
  onSuggest?: (q: string) => void; // 快捷追问气泡：点了直接发送（仅最后一条助手消息传入）
  onFeedback?: (id: string, value: "up" | "down" | null) => void;
  onFeedbackDetail?: (id: string, reasons: string[], text: string) => void; // 踩原因随消息落库（T2.5）
}) {
  const toast = useUI((s) => s.toast);
  const stalled = useStalled(msg.content, !!msg.streaming); // 流式卡顿感知(>1.8s无新字)
  const [fb, setFb] = useState<"up" | "down" | null>(msg.feedback ?? null);
  const [showFb, setShowFb] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        {/* whitespace-pre-wrap：用户消息里的换行必须保留（多行提问挤成一行没法读） */}
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-celadon-soft px-3.5 py-2.5 text-sm leading-6 text-ink transition dark:bg-celadon/20 dark:text-dark-text">
          {/* 语音占位：松手后先显三个跳动点「…」，识别完替换成语音文字 */}
          {msg.voicePending ? <VoiceDots /> : msg.content}
        </div>
      </div>
    );
  }

  // 用 .trim()：模型调工具前常吐一个换行 / <think> 剥离后残留空白——此时 content 非空但无可见文字，
  // 若按 !msg.content 判定会落到气泡分支渲染出「空白气泡 + 框外状态」（很难看）；空白一律视作"还没说话"，
  // 走思考中水波纹分支（把 toolNote 如「翻阅图书」扫光显示），不出空气泡。
  const thinking = msg.streaming && !msg.content.trim();
  // 卡片交错渲染：按占位标记切段，卡片出现在工具调用的真实位置；
  // 没有标记的老消息（或停止时标记还没吐出来）回退为渲染在末尾，卡不会丢
  const segments = splitCardSegments(msg.content);
  const lastSegIdx = segments.length - 1; // 呼吸点内联锚点：卡顿时点在最后一段文字的末字之后(不换行)
  // 联网来源卡聚合（豆包式）：一次回答里多次搜索的来源合并成一张卡（按搜索词分组），只在第一个 web 标记位置渲染一次、
  // 带上全部 webSources；其余 web 标记不再各出一张卡。无任何 web 标记（老消息/中途停止）时由末尾回退渲染。
  const firstWebSegIdx = segments.findIndex((s) => s.kind === "web");
  // 各类卡片已被正文内标记覆盖到的上界（from/to 连续追加，故已渲染区间恒为 [0,maxTo)）：末尾按差集只补渲
  // 尚未被任何已现标记覆盖的剩余卡片，避免「停在第一批标记后、第二批卡丢失」（旧的全有全无回退会整组丢卡）。
  const coveredTo = (kind: "recs" | "cites" | "web") => segments.reduce((mx, s) => (s.kind === kind ? Math.max(mx, s.to) : mx), 0);
  const recsDone = coveredTo("recs");
  const citesDone = coveredTo("cites");
  const webDone = coveredTo("web");

  function submitFeedback() {
    onFeedbackDetail?.(msg.id, picked, picked.includes("其它") ? other.trim() : "");
    setShowFb(false);
    setOther("");
    toast("收到啦，下次我注意");
  }

  return (
    <div>
      {thinking ? (
        // 思考中 / 过程提示：水波纹扫光文字（T8 统一等待表达，无省略号无跳点）
        <div className="flex items-center py-1.5 text-sm">
          <ThinkingNote override={msg.toolNote} />
        </div>
      ) : (
        <div className="rounded-2xl rounded-tl-sm bg-snow px-3.5 py-3 shadow-sm transition dark:bg-dark-card">
          {/* 不放流式光标：Markdown 渲染为块级段落，光标会被挤到独立一行像根"杵着的竖线" */}
          {segments.map((seg, i) => {
            if (seg.kind === "text") {
              if (!seg.text.trim()) return null;
              return (
                <div key={i} className={"prose-cn" + (msg.streaming && stalled && i === lastSegIdx ? " stall-inline" : "")}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                    {fixCjkBold(seg.text)}
                  </ReactMarkdown>
                </div>
              );
            }
            if (seg.kind === "recs") {
              const books = (msg.recommendations ?? []).slice(seg.from, seg.to);
              return books.length ? <RecsBlock key={i} books={books} /> : null;
            }
            if (seg.kind === "web") {
              // 聚合：只在第一个 web 标记处渲染一张卡、含全部来源（按搜索词分组）；其余 web 标记跳过
              return i === firstWebSegIdx && (msg.webSources?.length ?? 0) > 0 ? <WebBlock key={i} sources={msg.webSources!} locked={!!msg.streaming} /> : null;
            }
            const cites = (msg.citations ?? []).slice(seg.from, seg.to);
            return cites.length ? <CitesBlock key={i} cites={cites} /> : null;
          })}

          {/* 回退：数组里有卡但正文没有对应标记（老消息/中途停止）→ 渲染在末尾。
              流式中不回退：标记还在路上，先出现在末尾再跳到正确位置会很怪 */}
          {!msg.streaming && (msg.citations?.length ?? 0) > citesDone && <CitesBlock cites={msg.citations!.slice(citesDone)} />}
          {!msg.streaming && (msg.recommendations?.length ?? 0) > recsDone && <RecsBlock books={msg.recommendations!.slice(recsDone)} />}
          {!msg.streaming && firstWebSegIdx < 0 && (msg.webSources?.length ?? 0) > 0 && <WebBlock sources={msg.webSources!} />}
          {/* 流式卡顿呼吸点兜底：末段是卡片(非文字)时退回独立一行；末段是文字时已内联在末字后 */}
          {msg.streaming && !!msg.content.trim() && stalled && segments[lastSegIdx]?.kind !== "text" && <div><StallDots /></div>}
          {/* 断线截断尾注：与正文解耦，仅展示用、不进回灌上下文（Bug#11） */}
          {msg.truncated && (
            <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-300 dark:border-white/10">（后面断线了，回答可能不完整——可以点「继续生成」从断处接着补全）</p>
          )}
          {/* 快捷追问气泡：答疑收尾的「接着聊」台阶（章节卡=读原文，追问气泡=继续聊，两套入口各干各的）。
              仅最后一条助手消息、非流式时可点；点击即发送 */}
          {!msg.streaming && onSuggest && (msg.suggestions?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 animate-fade-up">
              {msg.suggestions!.slice(0, 3).map((q) => (
                <button
                  key={q}
                  onClick={() => onSuggest(q)}
                  className="rounded-full border border-celadon/50 bg-celadon-soft/40 px-3 py-1.5 text-xs text-celadon-700 active:scale-95 dark:border-celadon/30 dark:bg-celadon/10 dark:text-celadon-300"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 工具调用/思考过程提示（已有正文时显示在气泡下方）：水波纹扫光，正文继续输出时由事件清除（淡出）。
          .trim()：仅在有"可见正文"时才挂气泡下方；纯空白由上面的思考中分支接管，避免空气泡下又冒一条状态 */}
      {msg.streaming && !!msg.content.trim() && msg.toolNote && (
        <div className="mt-1.5 flex items-center pl-1 text-xs animate-fade-up">
          <ShimmerText text={msg.toolNote} />
        </div>
      )}

      {/* 操作栏（触区统一 32px，视觉图标不变） */}
      {!msg.streaming && (
        <div className="mt-1 flex items-center gap-1 pl-0.5 text-ink-300">
          {/* 错误/空占位气泡不显示赞 / 踩 / 复制（无内容可评价或复制），仅保留「重新生成」入口 */}
          {!msg.error && (<>
          <button
            aria-label="赞"
            aria-pressed={fb === "up"}
            className="flex h-8 w-8 items-center justify-center"
            onClick={() => {
              const v = fb === "up" ? null : "up";
              setFb(v);
              setShowFb(false);
              onFeedback?.(msg.id, v);
              if (v) toast("记住了，你喜欢这样的讲法");
            }}
          >
            <ThumbsUp size={15} className={fb === "up" ? "text-celadon" : ""} />
          </button>
          <button
            aria-label="踩"
            aria-pressed={fb === "down"}
            className="flex h-8 w-8 items-center justify-center"
            onClick={() => {
              const v = fb === "down" ? null : "down";
              setFb(v);
              setShowFb(v === "down");
              if (v === "down" && msg.feedbackReasons?.length) setPicked(msg.feedbackReasons);
              onFeedback?.(msg.id, v);
            }}
          >
            <ThumbsDown size={15} className={fb === "down" ? "text-celadon" : ""} />
          </button>
          <button
            aria-label="复制"
            className="flex h-8 w-8 items-center justify-center"
            onClick={() => {
              if (navigator.clipboard?.writeText) {
                // 复制给人看的文本：剥掉卡片占位标记
                navigator.clipboard.writeText(stripCardMarkers(msg.content)).then(() => toast("已复制")).catch(() => toast("复制失败", "error"));
              } else {
                toast("复制失败", "error");
              }
            }}
          >
            <Copy size={15} />
          </button>
          </>)}
          {onContinue ? (
            // 回答被截断：显示「继续生成」（从断点接着写，不丢已生成内容），替代「重新生成」
            <button onClick={onContinue} className="flex h-8 items-center gap-1 px-1.5 text-xs text-celadon-700 dark:text-celadon-300">
              <ChevronRight size={14} /> 继续生成
            </button>
          ) : onRegenerate ? (
            <button onClick={onRegenerate} className="flex h-8 items-center gap-1 px-1.5 text-xs text-celadon-700 dark:text-celadon-300">
              <RotateCw size={14} /> 重新生成
            </button>
          ) : null}
          {/* 反馈留痕：踩过且填过原因 → 常驻小标，点按可重新修改（"它记住了"看得见） */}
          {fb === "down" && !showFb && msg.feedbackReasons && msg.feedbackReasons.length > 0 && (
            <button
              onClick={() => { setPicked(msg.feedbackReasons ?? []); setShowFb(true); }}
              className="ml-auto flex h-8 items-center gap-1 px-1 text-[11px] text-ink-300"
            >
              <Pencil size={11} /> 已反馈 · {msg.feedbackReasons[0]}
            </button>
          )}
        </div>
      )}

      {/* 点踩反馈浮层：点击空白处不提交即关闭（层级须高于输入区/底栏 z-40，否则盖不住） */}
      {showFb && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setShowFb(false)} />
          <div className="relative z-[56] mt-2 rounded-lg border border-line bg-snow p-3 shadow-lg dark:border-white/10 dark:bg-dark-card">
            <p className="mb-2 text-xs text-ink-500 dark:text-dark-text/60">哪里没说好？告诉我，下次改</p>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK.map((f) => (
                <button
                  key={f}
                  onClick={() => setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))}
                  className={"rounded-full px-2.5 py-1.5 text-xs " + (picked.includes(f) ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg dark:text-dark-text/70")}
                >
                  {f}
                </button>
              ))}
            </div>
            {picked.includes("其它") && (
              <textarea
                autoFocus
                value={other}
                onChange={(e) => setOther(e.target.value.slice(0, 200))}
                placeholder="说说具体问题"
                className="mt-2 h-16 w-full resize-none rounded-lg border border-line bg-moon p-2 text-xs text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-bg dark:text-dark-text"
              />
            )}
            <button
              onClick={submitFeedback}
              className="mt-3 rounded-full bg-celadon px-4 py-1.5 text-xs text-snow active:scale-95"
            >
              提交
            </button>
          </div>
        </>
      )}
    </div>
  );
});
