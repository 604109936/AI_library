"use client";
import { memo, useState, useEffect } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { ThumbsUp, ThumbsDown, Copy, RotateCw, Pencil, ExternalLink, ChevronDown, Globe } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { ShimmerText } from "@/components/chat/ShimmerText";
import { splitCardSegments, stripCardMarkers, hasCardMarker } from "@/lib/chatMarkers";
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
      <p className="mb-2 text-xs font-medium text-ink-700 dark:text-dark-text/70">为你挑的书</p>
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
      <p className="text-[11px] text-ink-300">依据原文 {cites.length} 处，点击可直达</p>
      {cites.map((c, i) => (
        <Link
          key={i}
          href={`/library/book/${c.bookId}/read?ch=${c.bookId}-c${c.chapterNo}`}
          className="flex gap-2 rounded-xl border border-line p-2 active:bg-moon/50 dark:border-white/10 dark:active:bg-white/5"
        >
          <BookCover title={c.bookTitle} seed={c.coverSeed} src={c.cover} className="w-9 shrink-0" showText={false} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink dark:text-dark-text">《{c.bookTitle}》第{c.chapterNo}章 {c.chapterTitle}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-500 dark:text-dark-text/55">{c.snippet}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* 联网来源卡组（T10）：与引用章节卡同风格的列表卡，点击外链新开页。
   域名 + 日期给可信度参照；不渲染 snippet（正文已综合作答，来源卡只管溯源） */
function WebBlock({ sources }: { sources: WebSource[] }) {
  const [open, setOpen] = useState(false); // 默认折叠，点击展开来源列表（参考豆包）
  return (
    <div className="my-3 animate-fade-up first:mt-0 last:mb-0">
      {/* 折叠头：默认收起，仅显示「参考 N 篇资料」，点击展开来源列表 */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-xl border border-line bg-snow/60 px-3 py-2 text-xs text-ink-500 active:bg-moon/50 dark:border-white/10 dark:bg-white/5 dark:text-dark-text/60 dark:active:bg-white/10"
      >
        <Globe size={13} className="shrink-0 text-celadon" />
        <span>联网搜索 · 参考 {sources.length} 篇资料</span>
        <ChevronDown size={14} className={"ml-auto shrink-0 text-ink-300 transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {sources.map((s, i) => {
        // 协议白名单（纵深防御）：历史 jsonb 或上游若混入 javascript:/data: 协议，不渲染为可点链接
        let host = "";
        let safe = false;
        try {
          const u = new URL(s.u);
          host = u.hostname.replace(/^www\./, "");
          safe = u.protocol === "http:" || u.protocol === "https:";
        } catch {}
        if (!safe) {
          return (
            <div key={i} className="rounded-xl border border-line p-2.5 text-xs text-ink-500 dark:border-white/10 dark:text-dark-text/55">
              {s.t}
            </div>
          );
        }
        return (
          <a
            key={i}
            href={s.u}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl border border-line p-2.5 active:bg-moon/50 dark:border-white/10 dark:active:bg-white/5"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-celadon-soft text-[11px] font-medium text-celadon-700 dark:bg-celadon/15 dark:text-celadon-300">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink dark:text-dark-text">{s.t}</p>
              <p className="mt-0.5 truncate text-[10px] text-ink-300">
                {host}
                {s.d ? ` · ${s.d}` : ""}
              </p>
            </div>
            <ExternalLink size={13} className="shrink-0 text-ink-300" />
          </a>
        );
          })}
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
  onFeedback,
  onFeedbackDetail,
}: {
  msg: TMsg;
  onRegenerate?: () => void;
  onFeedback?: (id: string, value: "up" | "down" | null) => void;
  onFeedbackDetail?: (id: string, reasons: string[], text: string) => void; // 踩原因随消息落库（T2.5）
}) {
  const toast = useUI((s) => s.toast);
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

  const thinking = msg.streaming && !msg.content;
  // 卡片交错渲染：按占位标记切段，卡片出现在工具调用的真实位置；
  // 没有标记的老消息（或停止时标记还没吐出来）回退为渲染在末尾，卡不会丢
  const segments = splitCardSegments(msg.content);
  const recsInFlow = hasCardMarker(msg.content, "recs");
  const citesInFlow = hasCardMarker(msg.content, "cites");
  const webInFlow = hasCardMarker(msg.content, "web");

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
                <div key={i} className="prose-cn">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                    {seg.text}
                  </ReactMarkdown>
                </div>
              );
            }
            if (seg.kind === "recs") {
              const books = (msg.recommendations ?? []).slice(seg.from, seg.to);
              return books.length ? <RecsBlock key={i} books={books} /> : null;
            }
            if (seg.kind === "web") {
              const sources = (msg.webSources ?? []).slice(seg.from, seg.to);
              return sources.length ? <WebBlock key={i} sources={sources} /> : null;
            }
            const cites = (msg.citations ?? []).slice(seg.from, seg.to);
            return cites.length ? <CitesBlock key={i} cites={cites} /> : null;
          })}

          {/* 回退：数组里有卡但正文没有对应标记（老消息/中途停止）→ 渲染在末尾。
              流式中不回退：标记还在路上，先出现在末尾再跳到正确位置会很怪 */}
          {!msg.streaming && !citesInFlow && !!msg.citations?.length && <CitesBlock cites={msg.citations} />}
          {!msg.streaming && !recsInFlow && !!msg.recommendations?.length && <RecsBlock books={msg.recommendations} />}
          {!msg.streaming && !webInFlow && !!msg.webSources?.length && <WebBlock sources={msg.webSources} />}
          {/* 断线截断尾注：与正文解耦，仅展示用、不进回灌上下文（Bug#11） */}
          {msg.truncated && (
            <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-300 dark:border-white/10">（后面断线了，回答可能不完整——可以点「重新生成」补全）</p>
          )}
        </div>
      )}

      {/* 工具调用/思考过程提示（已有正文时显示在气泡下方）：水波纹扫光，正文继续输出时由事件清除（淡出） */}
      {msg.streaming && !!msg.content && msg.toolNote && (
        <div className="mt-1.5 flex items-center pl-1 text-xs animate-fade-up">
          <ShimmerText text={msg.toolNote} />
        </div>
      )}

      {/* 操作栏（触区统一 32px，视觉图标不变） */}
      {!msg.streaming && (
        <div className="mt-1 flex items-center gap-1 pl-0.5 text-ink-300">
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
          {onRegenerate && (
            <button onClick={onRegenerate} className="flex h-8 items-center gap-1 px-1.5 text-xs text-celadon-700 dark:text-celadon-300">
              <RotateCw size={14} /> 重新生成
            </button>
          )}
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
