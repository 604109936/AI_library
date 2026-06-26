"use client";
import { memo, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { ThumbsUp, ThumbsDown, Copy, RotateCw, Pencil, ExternalLink } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { ShimmerText } from "@/components/chat/ShimmerText";
import { splitCardSegments, stripCardMarkers, hasCardMarker } from "@/lib/chatMarkers";
import { useAuth, useLibrary, useUI } from "@/lib/store";
import type { Book, Citation, WebSource, ChatMessage as TMsg } from "@/lib/types";

// 反馈标签（对齐补充文档：推荐偏差 / 答疑有误 / 解读没用 / 其它，「其它」可个性化输入）
const FEEDBACK = ["推荐偏差", "答疑有误", "解读没用", "其它"];

// 等待文案轮换：思考过程提示（服务端 status 事件）优先；没有提示时本地句池轮换兜底。
// 登录/游客两套（游客没有书架，"翻了翻你的书架"是谎言）；走到尾后在最后两句间交替，不会卡死在"快好了"。
// 全部以水波纹扫光呈现（T8 统一等待表达）
const THINKING_USER = ["让我想想", "翻了翻你的书架", "正在组织语言", "内容有点多，再等等我", "快好了"];
const THINKING_GUEST = ["让我想想", "在馆里找了找", "正在组织语言", "内容有点多，再等等我", "快好了"];
function ThinkingNote({ override }: { override?: string }) {
  const logged = useAuth((s) => !!s.user);
  const list = logged ? THINKING_USER : THINKING_GUEST;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (override) return; // 服务端过程提示优先，不轮换
    const t = setInterval(() => setI((x) => x + 1), 2600);
    return () => clearInterval(t);
  }, [override]);
  const idx = i < list.length ? i : list.length - 2 + ((i - list.length) % 2); // 尾部两句循环交替
  return <ShimmerText text={override || list[idx]} />;
}

// 推荐卡"懂你"徽标：已读完 > 在读 N% > 在书架（数据全在本地 store，游客自然为空）
function recBadge(bookId: string, fav: boolean, pct: number, played: number): { text: string; done?: boolean } | null {
  const p = Math.max(pct, played * 100);
  if (pct >= 100 || played >= 0.9) return { text: "已读完", done: true };
  if (p > 0) return { text: `在读 ${Math.round(p)}%` };
  if (fav) return { text: "在书架" };
  return null;
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
  const favorites = useLibrary((s) => s.favorites);
  const progress = useLibrary((s) => s.progress);
  const mediaPlayed = useLibrary((s) => s.mediaPlayed);
  return (
    <div className="my-3 animate-fade-up first:mt-0 last:mb-0">
      <p className="mb-2 text-xs font-medium text-ink-700 dark:text-dark-text/70">为你挑的书</p>
      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 no-scrollbar">
        {books.map((b) => {
          const badge = recBadge(b.id, favorites.includes(b.id), progress[b.id]?.pct ?? 0, mediaPlayed[b.id] ?? 0);
          return (
            <Link key={b.id} href={`/library/book/${b.id}`} className="w-[88px] shrink-0">
              <div className="relative">
                <BookCover title={b.title} seed={b.coverSeed} src={b.cover} className="w-[88px]" showText={false} />
                {badge && (
                  <span className={"absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none text-snow " + (badge.done ? "bg-ink/55" : "bg-celadon/90")}>
                    {badge.text}
                  </span>
                )}
              </div>
              <p className="mt-1.5 truncate text-xs text-ink dark:text-dark-text">{b.title}</p>
              <p className="truncate text-[10px] text-ink-300">{b.author}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* 引用章节卡组：出处与读者进度缝起来（"你正读到这里/你读过这章"），点击直达原文 */
function CitesBlock({ cites }: { cites: Citation[] }) {
  const progress = useLibrary((s) => s.progress);
  return (
    <div className="my-3 animate-fade-up space-y-2 first:mt-0 last:mb-0">
      <p className="text-[11px] text-ink-300">依据原文 {cites.length} 处，点击可直达</p>
      {cites.map((c, i) => {
        const myCh = progress[c.bookId]?.chapterNo ?? 0;
        const mark = myCh === c.chapterNo ? "你正读到这里" : myCh > c.chapterNo ? "你读过这章" : null;
        return (
          <Link
            key={i}
            href={`/library/book/${c.bookId}/read?ch=${c.bookId}-c${c.chapterNo}`}
            className="flex gap-2 rounded-xl border border-line p-2 active:bg-moon/50 dark:border-white/10 dark:active:bg-white/5"
          >
            <BookCover title={c.bookTitle} seed={c.coverSeed} src={c.cover} className="w-9 shrink-0" showText={false} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-1.5">
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-ink dark:text-dark-text">《{c.bookTitle}》第{c.chapterNo}章 {c.chapterTitle}</p>
                {mark && <span className="shrink-0 text-[10px] text-celadon-700 dark:text-celadon-300">{mark}</span>}
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-500 dark:text-dark-text/55">{c.snippet}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/* 联网来源卡组（T10）：与引用章节卡同风格的列表卡，点击外链新开页。
   域名 + 日期给可信度参照；不渲染 snippet（正文已综合作答，来源卡只管溯源） */
function WebBlock({ sources }: { sources: WebSource[] }) {
  return (
    <div className="my-3 animate-fade-up space-y-2 first:mt-0 last:mb-0">
      <p className="text-[11px] text-ink-300">来源 {sources.length} 处，点击可查看</p>
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
          {msg.content}
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
