"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThumbsUp, ThumbsDown, Copy, RotateCw, Pencil } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { Mascot } from "@/components/chat/Mascot";
import { Skeleton } from "@/components/ui/States";
import { useAuth, useLibrary, useUI } from "@/lib/store";
import type { ChatMessage as TMsg } from "@/lib/types";

// 反馈标签（对齐补充文档：推荐偏差 / 答疑有误 / 解读没用 / 其它，「其它」可个性化输入）
const FEEDBACK = ["推荐偏差", "答疑有误", "解读没用", "其它"];

// 等待文案轮换：M3 思考期约 5~8 秒，固定"思考中"显得卡死；换着说话让等待有进度感。
// 登录/游客两套（游客没有书架，"翻了翻你的书架"是谎言）；走到尾后在最后两句间交替，不会卡死在"快好了"
const THINKING_USER = ["让我想想", "翻了翻你的书架", "正在组织语言", "内容有点多，再等等我", "快好了"];
const THINKING_GUEST = ["让我想想", "在馆里找了找", "正在组织语言", "内容有点多，再等等我", "快好了"];
function ThinkingNote({ override }: { override?: string }) {
  const logged = useAuth((s) => !!s.user);
  const list = logged ? THINKING_USER : THINKING_GUEST;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (override) return; // 工具调用文案优先，不轮换
    const t = setInterval(() => setI((x) => x + 1), 2600);
    return () => clearInterval(t);
  }, [override]);
  const idx = i < list.length ? i : list.length - 2 + ((i - list.length) % 2); // 尾部两句循环交替
  return <>{override || list[idx]}</>;
}

// 推荐卡"懂你"徽标：已读完 > 在读 N% > 在书架（数据全在本地 store，游客自然为空）
function recBadge(bookId: string, fav: boolean, pct: number, played: number): { text: string; done?: boolean } | null {
  const p = Math.max(pct, played * 100);
  if (pct >= 100 || played >= 0.9) return { text: "已读完", done: true };
  if (p > 0) return { text: `在读 ${Math.round(p)}%` };
  if (fav) return { text: "在书架" };
  return null;
}

export function ChatMessage({
  msg,
  onRegenerate,
  onFeedback,
  onFeedbackDetail,
  highlight,
}: {
  msg: TMsg;
  onRegenerate?: () => void;
  onFeedback?: (value: "up" | "down" | null) => void;
  onFeedbackDetail?: (reasons: string[], text: string) => void; // 踩原因随消息落库（T2.5）
  highlight?: boolean;
}) {
  const ringCls = highlight ? " ring-2 ring-celadon/70 ring-offset-2 ring-offset-moon dark:ring-offset-dark-bg" : "";
  const toast = useUI((s) => s.toast);
  const favorites = useLibrary((s) => s.favorites);
  const progress = useLibrary((s) => s.progress);
  const mediaPlayed = useLibrary((s) => s.mediaPlayed);
  const [fb, setFb] = useState<"up" | "down" | null>(msg.feedback ?? null);
  const [showFb, setShowFb] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        {/* whitespace-pre-wrap：用户消息里的换行必须保留（多行提问挤成一行没法读） */}
        <div className={"max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-celadon-soft px-3.5 py-2.5 text-sm leading-6 text-ink transition dark:bg-celadon/20 dark:text-dark-text" + ringCls}>
          {msg.content}
        </div>
      </div>
    );
  }

  const thinking = msg.streaming && !msg.content;

  function submitFeedback() {
    onFeedbackDetail?.(picked, picked.includes("其它") ? other.trim() : "");
    setShowFb(false);
    setOther("");
    toast("收到啦，下次我注意");
  }

  return (
    <div className="flex gap-2">
      <Mascot size={32} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {thinking ? (
          // 思考中 / 工具调用文案：不套整块气泡，只显示文字 + 动效（等待文案随时间轮换）
          <div className="flex items-center gap-1.5 py-1.5 text-sm text-ink-400 dark:text-dark-text/50">
            <ThinkingNote override={msg.toolNote} />
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon [animation-delay:-0.2s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon [animation-delay:-0.1s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon" />
            </span>
          </div>
        ) : (
          <div className={"rounded-2xl rounded-tl-sm bg-snow px-3.5 py-3 shadow-sm transition dark:bg-dark-card" + ringCls}>
            {/* 不放流式光标：Markdown 渲染为块级段落，光标会被挤到独立一行像根"杵着的竖线" */}
            <div className="prose-cn">
              {/* 表格在手机气泡里必然挤爆（用户明确不要表格）：System 已禁止小涤输出表格，
                  这里再做渲染兜底——万一漏出表格语法，降级为紧凑的行式列表而非 <table> */}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children }) => <div className="my-2 space-y-1.5 text-sm">{children}</div>,
                  thead: ({ children }) => <div className="pb-1 font-medium text-ink dark:text-dark-text">{children}</div>,
                  tbody: ({ children }) => <div className="space-y-1.5">{children}</div>,
                  tr: ({ children }) => <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">{children}</div>,
                  th: ({ children }) => <span className="font-medium">{children}</span>,
                  td: ({ children }) => <span className="text-ink-700 dark:text-dark-text/80">{children}</span>,
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>

            {/* 流式中卡片数据已就绪：先亮骨架卡占位（"书正在从架上取下来"），收尾时换真卡 */}
            {msg.streaming && msg.recsPending && !msg.recommendations && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-ink-700 dark:text-dark-text/70">为你挑的书</p>
                <div className="flex gap-2.5">
                  {[0, 1].map((i) => (
                    <div key={i} className="w-[88px]">
                      <Skeleton className="aspect-[3/4] w-[88px] rounded-lg" />
                      <Skeleton className="mt-1.5 h-3 w-16 rounded" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 引用卡 */}
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-ink-300">依据原文 {msg.citations.length} 处，点击可直达</p>
                {msg.citations.map((c, i) => {
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
                          {/* 出处与我的进度缝起来：从"查资料"变成"回到我的书" */}
                          {mark && <span className="shrink-0 text-[10px] text-celadon-700 dark:text-celadon-300">{mark}</span>}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-500 dark:text-dark-text/55">{c.snippet}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* 推荐书目：封面叠"懂你"徽标（已读完 / 在读 N% / 在书架） */}
            {msg.recommendations && msg.recommendations.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-ink-700 dark:text-dark-text/70">为你挑的书</p>
                <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 no-scrollbar">
                  {msg.recommendations.map((b) => {
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
            )}
          </div>
        )}

        {/* 工具调用中（已有正文时显示在气泡下方）：在书架间找书… / 翻开这本书… / 细读章节… */}
        {msg.streaming && !!msg.content && msg.toolNote && (
          <div className="mt-1.5 flex items-center gap-1.5 pl-1 text-xs text-ink-400 dark:text-dark-text/50">
            {msg.toolNote}
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon [animation-delay:-0.2s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon [animation-delay:-0.1s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon" />
            </span>
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
                onFeedback?.(v);
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
                onFeedback?.(v);
              }}
            >
              <ThumbsDown size={15} className={fb === "down" ? "text-celadon" : ""} />
            </button>
            <button
              aria-label="复制"
              className="flex h-8 w-8 items-center justify-center"
              onClick={() => {
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(msg.content).then(() => toast("已复制")).catch(() => toast("复制失败", "error"));
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
                  placeholder="说说具体问题…"
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
    </div>
  );
}
