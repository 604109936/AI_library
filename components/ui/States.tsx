"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BookX, WifiOff, Inbox, NotebookPen, Star, Clock, SearchX } from "lucide-react";
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
