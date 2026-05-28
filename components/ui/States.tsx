"use client";
import { cn } from "@/lib/utils";
import { BookX, WifiOff, Inbox } from "lucide-react";
import Link from "next/link";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function EmptyState({
  icon = "inbox",
  title,
  subtitle,
  actionText,
  actionHref,
  onAction,
}: {
  icon?: "inbox" | "book";
  title: string;
  subtitle?: string;
  actionText?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  const Icon = icon === "book" ? BookX : Inbox;
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-celadon-soft">
        <Icon className="text-celadon" size={40} strokeWidth={1.4} />
      </div>
      <p className="font-serif text-lg text-ink">{title}</p>
      {subtitle && <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>}
      {actionText &&
        (actionHref ? (
          <Link
            href={actionHref}
            className="mt-6 rounded-full bg-celadon px-6 py-2.5 text-sm text-snow shadow-celadon active:scale-95 transition"
          >
            {actionText}
          </Link>
        ) : (
          <button
            onClick={onAction}
            className="mt-6 rounded-full bg-celadon px-6 py-2.5 text-sm text-snow shadow-celadon active:scale-95 transition"
          >
            {actionText}
          </button>
        ))}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-line/60">
        <WifiOff className="text-ink-500" size={38} strokeWidth={1.4} />
      </div>
      <p className="font-serif text-lg text-ink">网络开小差了</p>
      <p className="mt-1.5 text-sm text-ink-500">请检查网络后重试</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-6 rounded-full border border-celadon px-6 py-2.5 text-sm text-celadon-700 active:scale-95 transition"
        >
          重试
        </button>
      )}
    </div>
  );
}
