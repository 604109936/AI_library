"use client";
import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThumbsUp, ThumbsDown, Copy, RotateCw, Sparkles } from "lucide-react";
import { BookCover } from "@/components/ui/BookCover";
import { useUI } from "@/lib/store";
import type { ChatMessage as TMsg } from "@/lib/types";

const FEEDBACK = ["提示词不准", "事实错误", "格式问题", "其他"];

export function ChatMessage({
  msg,
  onRegenerate,
}: {
  msg: TMsg;
  onRegenerate?: () => void;
}) {
  const toast = useUI((s) => s.toast);
  const [fb, setFb] = useState<"up" | "down" | null>(msg.feedback ?? null);
  const [showFb, setShowFb] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-rouge/10 px-3.5 py-2.5 text-sm leading-6 text-ink dark:text-dark-text">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-celadon-soft">
        <Sparkles size={16} className="text-celadon-700" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-sm bg-snow px-3.5 py-3 shadow-sm dark:bg-dark-card">
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
                  className="flex gap-2 rounded-lg border border-line p-2"
                >
                  <BookCover title={c.bookTitle} seed={c.coverSeed} className="w-9 shrink-0" showText={false} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink dark:text-dark-text">《{c.bookTitle}》第{c.chapterNo}章 {c.chapterTitle}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-500">{c.snippet}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* 推荐书目 */}
          {msg.recommendations && msg.recommendations.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] text-ink-300">推荐书目</p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 no-scrollbar">
                {msg.recommendations.map((b) => (
                  <Link key={b.id} href={`/library/book/${b.id}`} className="w-16 shrink-0">
                    <BookCover title={b.title} seed={b.coverSeed} className="w-16" showText={false} />
                    <p className="mt-1 truncate text-[10px] text-ink-500">{b.title}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 操作栏 */}
        {!msg.streaming && (
          <div className="mt-1.5 flex items-center gap-3 pl-1 text-ink-300">
            <button onClick={() => { setFb("up"); toast("感谢反馈"); }}>
              <ThumbsUp size={15} className={fb === "up" ? "text-celadon" : ""} />
            </button>
            <button onClick={() => { setFb("down"); setShowFb(true); }}>
              <ThumbsDown size={15} className={fb === "down" ? "text-celadon" : ""} />
            </button>
            <button onClick={() => { navigator.clipboard?.writeText(msg.content); toast("已复制"); }}>
              <Copy size={15} />
            </button>
            {onRegenerate && (
              <button onClick={onRegenerate} className="flex items-center gap-1 text-xs text-celadon-700">
                <RotateCw size={14} /> 重新生成
              </button>
            )}
          </div>
        )}

        {/* 点踩反馈浮层 */}
        {showFb && (
          <div className="mt-2 rounded-lg border border-line bg-snow p-3 dark:bg-dark-card">
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
}
