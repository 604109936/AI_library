"use client";
import { memo, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThumbsUp, ThumbsDown, Copy, RotateCw } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { Mascot } from "@/components/chat/Mascot";
import { IconButton } from "@/components/ui/IconButton";
import { useUI } from "@/lib/store";
import type { ChatMessage as TMsg } from "@/lib/types";

// 点踩反馈选项：用读者语言而非「提示词」等工程术语
const FEEDBACK = ["答非所问", "内容有误", "排版混乱", "其他"];

export const ChatMessage = memo(function ChatMessage({
  msg,
  error,
  onRegenerate,
  onFeedback,
}: {
  msg: TMsg;
  error?: boolean;
  onRegenerate?: () => void;
  onFeedback?: (id: string, fb: "up" | "down" | null) => void;
}) {
  const toast = useUI((s) => s.toast);
  const [fb, setFb] = useState<"up" | "down" | null>(msg.feedback ?? null);
  const [showFb, setShowFb] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // 从历史重开会话时 props 变化要刷新本地高亮
  useEffect(() => setFb(msg.feedback ?? null), [msg.feedback]);

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-celadon-soft px-3.5 py-2.5 text-sm leading-6 text-ink dark:bg-celadon/20 dark:text-dark-text">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Mascot size={32} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {error ? (
          // 失败态：内联错误条 + 重试
          <div className="rounded-2xl rounded-tl-sm border border-rouge/30 bg-rouge/5 px-3.5 py-3 text-xs text-rouge">
            回答生成失败
            {onRegenerate && (
              <button onClick={onRegenerate} className="ml-1 font-medium underline underline-offset-2">
                点此重试
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-2xl rounded-tl-sm bg-snow px-3.5 py-3 shadow-sm dark:bg-dark-card">
            <div className="prose-cn">
              {msg.streaming ? (
                // 流式态降级为纯文本，避免每帧重新解析 markdown 与中间态样式跳变
                <p className="whitespace-pre-wrap break-words leading-7 text-ink dark:text-dark-text">
                  {msg.content}
                </p>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              )}
              {/* 首字未出=思考中三点律动；已出字=青瓷光标 */}
              {msg.streaming && msg.content === "" ? (
                <span className="flex gap-1 py-0.5" aria-label="正在思考">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-300"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </span>
              ) : msg.streaming ? (
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-celadon align-middle" />
              ) : null}
            </div>

            {/* 引用卡 */}
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-ink-300">引用了 {msg.citations.length} 个章节</p>
                {msg.citations.map((c, i) => (
                  <Link
                    key={i}
                    href={`/library/book/${c.bookId}/read?ch=${c.chapterId}`}
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
        {!msg.streaming && !error && (
          <div className="mt-1 flex items-center gap-1 pl-1 text-ink-300">
            <IconButton
              label="赞"
              active={fb === "up"}
              onClick={() => {
                const next = fb === "up" ? null : "up";
                setFb(next);
                onFeedback?.(msg.id, next);
                if (next) toast("感谢反馈");
              }}
            >
              <ThumbsUp size={15} className={fb === "up" ? "text-celadon" : ""} />
            </IconButton>
            <IconButton
              label="踩"
              active={fb === "down"}
              onClick={() => {
                const next = fb === "down" ? null : "down";
                setFb(next);
                onFeedback?.(msg.id, next);
                setShowFb(next === "down");
              }}
            >
              <ThumbsDown size={15} className={fb === "down" ? "text-celadon" : ""} />
            </IconButton>
            <IconButton
              label="复制"
              onClick={async () => {
                try {
                  if (!navigator.clipboard) throw new Error("no clipboard");
                  await navigator.clipboard.writeText(msg.content);
                  toast("已复制");
                } catch {
                  toast("复制失败，请长按选择");
                }
              }}
            >
              <Copy size={15} />
            </IconButton>
            {onRegenerate && (
              <button onClick={onRegenerate} className="flex items-center gap-1 pl-1 text-xs text-celadon-700">
                <RotateCw size={14} /> 重新生成
              </button>
            )}
          </div>
        )}

        {/* 点踩反馈浮层 */}
        {showFb && (
          <div className="mt-2 rounded-lg border border-line bg-snow p-3 dark:border-white/10 dark:bg-dark-card">
            <p className="mb-2 text-xs text-ink-500">反馈问题</p>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK.map((f) => (
                <button
                  key={f}
                  onClick={() => setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))}
                  className={"rounded-full px-2.5 py-1 text-xs " + (picked.includes(f) ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg")}
                >
                  {f}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setShowFb(false); toast("已收到，会继续改进"); }}
              className="mt-3 rounded-full bg-celadon px-4 py-1.5 text-xs text-snow"
            >
              提交
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
