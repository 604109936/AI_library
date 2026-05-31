"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BookX, WifiOff, Inbox, NotebookPen, Star, Clock, SearchX, AlertCircle, RotateCcw } from "lucide-react";
import Link from "next/link";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

type EmptyIcon = "inbox" | "book" | "note" | "review" | "history" | "search";
const ICONS: Record<EmptyIcon, typeof Inbox> = {
  inbox: Inbox,
  book: BookX,
  note: NotebookPen,
  review: Star,
  history: Clock,
  search: SearchX,
};

export function EmptyState({
  icon = "inbox",
  illustration,
  title,
  subtitle,
  actionText,
  actionHref,
  onAction,
}: {
  icon?: EmptyIcon;
  illustration?: string; // 线描插画图片路径，缺图时回退到图标圆
  title: string;
  subtitle?: string;
  actionText?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const Icon = ICONS[icon] ?? Inbox;
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      {illustration && imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={illustration}
          alt=""
          onError={() => setImgOk(false)}
          className="mb-5 h-44 w-44 object-contain opacity-95 dark:opacity-80"
        />
      ) : (
        <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-celadon-soft dark:bg-celadon/15">
          <Icon className="text-celadon" size={40} strokeWidth={1.4} />
        </div>
      )}
      <p className="font-serif text-lg text-ink dark:text-dark-text">{title}</p>
      {subtitle && <p className="mt-1.5 text-sm text-ink-500 dark:text-dark-text/60">{subtitle}</p>}
      {actionText &&
        (actionHref ? (
          <Link
            href={actionHref}
            className="mt-6 rounded-full bg-celadon px-6 py-2.5 text-sm text-snow shadow-celadon transition active:scale-95"
          >
            {actionText}
          </Link>
        ) : (
          <button
            onClick={onAction}
            className="mt-6 rounded-full bg-celadon px-6 py-2.5 text-sm text-snow shadow-celadon transition active:scale-95"
          >
            {actionText}
          </button>
        ))}
    </div>
  );
}

/** 媒体缓冲转圈（青瓷描边，明暗皆可读），叠加在视频/音频/乱翻加载态中央 */
export function MediaSpinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-9 w-9 animate-spin rounded-full border-2 border-celadon/70 border-t-transparent",
        className
      )}
      role="status"
      aria-label="加载中"
    />
  );
}

/** 媒体加载失败兜底（用于深色媒体面：视频黑卡 / 乱翻深底），含重试 */
export function MediaError({
  onRetry,
  text = "暂时无法播放",
  className,
}: {
  onRetry?: () => void;
  text?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 text-center", className)}>
      <AlertCircle size={26} className="text-white/70" />
      <p className="text-xs text-white/85">{text}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1 rounded-full border border-celadon/50 px-3 py-1 text-xs text-celadon-300 transition active:scale-95"
        >
          <RotateCcw size={12} /> 重试
        </button>
      )}
    </div>
  );
}

export function ErrorState({
  onRetry,
  title = "网络开小差了",
  subtitle = "请检查网络后重试",
  illustration,
}: {
  onRetry?: () => void;
  title?: string;
  subtitle?: string;
  illustration?: string;
}) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      {illustration && imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={illustration}
          alt=""
          onError={() => setImgOk(false)}
          className="mb-5 h-40 w-40 object-contain opacity-95 dark:opacity-80"
        />
      ) : (
        <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-line/60 dark:bg-white/5">
          <WifiOff className="text-ink-500 dark:text-dark-text/60" size={38} strokeWidth={1.4} />
        </div>
      )}
      <p className="font-serif text-lg text-ink dark:text-dark-text">{title}</p>
      <p className="mt-1.5 text-sm text-ink-500 dark:text-dark-text/60">{subtitle}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-6 rounded-full border border-celadon px-6 py-2.5 text-sm text-celadon-700 transition active:scale-95 dark:text-celadon-300"
        >
          重试
        </button>
      )}
    </div>
  );
}
