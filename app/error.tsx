"use client";
import Link from "next/link";
import { WifiOff } from "lucide-react";

/** 应用级错误边界：页面渲染/数据抛错时兜底，提供重试与回首页入口。 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center">
      <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-line/60 dark:bg-white/5">
        <WifiOff className="text-ink-500 dark:text-dark-text/60" size={38} strokeWidth={1.4} />
      </div>
      <p className="font-serif text-2xl text-ink dark:text-dark-text">出了点小状况</p>
      <p className="mt-2 text-sm text-ink-500 dark:text-dark-text/60">刷新或稍后再试，多数情况下重试即可恢复</p>
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-celadon px-6 py-2.5 text-sm text-snow shadow-celadon transition active:scale-95"
        >
          重试
        </button>
        <Link
          href="/library"
          className="rounded-full border border-celadon px-6 py-2.5 text-sm text-celadon-700 transition active:scale-95 dark:text-celadon-300"
        >
          回到泡馆
        </Link>
      </div>
    </main>
  );
}
