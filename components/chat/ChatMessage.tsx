"use client";
import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThumbsUp, ThumbsDown, Copy, RotateCw } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { Mascot } from "@/components/chat/Mascot";
import { useUI } from "@/lib/store";
import type { ChatMessage as TMsg } from "@/lib/types";

// 反馈标签（对齐补充文档：推荐偏差 / 答疑有误 / 解读没用 / 其它，「其它」可个性化输入）
const FEEDBACK = ["推荐偏差", "答疑有误", "解读没用", "其它"];

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
  const [fb, setFb] = useState<"up" | "down" | null>(msg.feedback ?? null);
  const [showFb, setShowFb] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className={"max-w-[80%] rounded-2xl rounded-tr-sm bg-celadon-soft px-3.5 py-2.5 text-sm leading-6 text-ink transition dark:bg-celadon/20 dark:text-dark-text" + ringCls}>
          {msg.content}
        </div>
      </div>
    );
  }

  const thinking = msg.streaming && !msg.content;

  function submitFeedback() {
    onFeedbackDetail?.(picked, picked.includes("其它") ? other.trim() : "");
    setShowFb(false);
    setPicked([]);
    setOther("");
    toast("已收到，会继续改进");
  }

  return (
    <div className="flex gap-2">
      <Mascot size={32} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {thinking ? (
          // 思考中 / 工具调用文案：不套整块气泡，只显示文字 + 动效
          <div className="flex items-center gap-1.5 py-1.5 text-sm text-ink-400 dark:text-dark-text/50">
            {msg.toolNote || "思考中"}
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon [animation-delay:-0.2s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon [animation-delay:-0.1s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-celadon" />
            </span>
          </div>
        ) : (
          <div className={"rounded-2xl rounded-tl-sm bg-snow px-3.5 py-3 shadow-sm transition dark:bg-dark-card" + ringCls}>
            <div className="prose-cn">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              {msg.streaming && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-celadon align-middle" />}
            </div>

            {/* 引用卡 */}
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-ink-300">引用了 {msg.citations.length} 个章节</p>
                {msg.citations.map((c, i) => (
                  <Link
                    key={i}
                    href={`/library/book/${c.bookId}/read?ch=${c.bookId}-c${c.chapterNo}`}
                    className="flex gap-2 rounded-xl border border-line p-2 dark:border-white/10"
                  >
                    <BookCover title={c.bookTitle} seed={c.coverSeed} src={c.cover} className="w-9 shrink-0" showText={false} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink dark:text-dark-text">《{c.bookTitle}》第{c.chapterNo}章 {c.chapterTitle}</p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-500 dark:text-dark-text/55">{c.snippet}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* 推荐书目 */}
            {msg.recommendations && msg.recommendations.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-medium text-ink-700 dark:text-dark-text/70">推荐书目</p>
                <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 no-scrollbar">
                  {msg.recommendations.map((b) => (
                    <Link key={b.id} href={`/library/book/${b.id}`} className="w-[88px] shrink-0">
                      <BookCover title={b.title} seed={b.coverSeed} src={b.cover} className="w-[88px]" showText={false} />
                      <p className="mt-1.5 truncate text-xs text-ink dark:text-dark-text">{b.title}</p>
                      <p className="truncate text-[10px] text-ink-300">{b.author}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 操作栏 */}
        {!msg.streaming && (
          <div className="mt-1.5 flex items-center gap-3 pl-1 text-ink-300">
            <button
              aria-label="赞"
              aria-pressed={fb === "up"}
              onClick={() => {
                const v = fb === "up" ? null : "up";
                setFb(v);
                setShowFb(false);
                onFeedback?.(v);
                if (v) toast("感谢反馈");
              }}
            >
              <ThumbsUp size={15} className={fb === "up" ? "text-celadon" : ""} />
            </button>
            <button
              aria-label="踩"
              aria-pressed={fb === "down"}
              onClick={() => {
                const v = fb === "down" ? null : "down";
                setFb(v);
                setShowFb(v === "down");
                onFeedback?.(v);
              }}
            >
              <ThumbsDown size={15} className={fb === "down" ? "text-celadon" : ""} />
            </button>
            <button
              aria-label="复制"
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
              <button onClick={onRegenerate} className="flex items-center gap-1 text-xs text-celadon-700">
                <RotateCw size={14} /> 重新生成
              </button>
            )}
          </div>
        )}

        {/* 点踩反馈浮层：点击空白处不提交即关闭 */}
        {showFb && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowFb(false)} />
            <div className="relative z-50 mt-2 rounded-lg border border-line bg-snow p-3 shadow-lg dark:border-white/10 dark:bg-dark-card">
              <p className="mb-2 text-xs text-ink-500 dark:text-dark-text/60">这条回答哪里不满意？</p>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK.map((f) => (
                  <button
                    key={f}
                    onClick={() => setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))}
                    className={"rounded-full px-2.5 py-1 text-xs " + (picked.includes(f) ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg dark:text-dark-text/70")}
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
