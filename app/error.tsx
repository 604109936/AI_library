"use client";
import Link from "next/link";
import { ErrorState } from "@/components/ui/States";

// 段级错误边界：渲染期异常在此兜底，提供重试与返回入口，避免整屏白屏。
// 注意 strict/noUnusedLocals：error 形参在类型里声明但不解构使用。
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-8">
      <ErrorState
        title="页面出了点状况"
        subtitle="可以重试，或返回泡馆继续逛逛"
        onRetry={reset}
      />
      <Link
        href="/library"
        className="mt-4 text-sm text-ink-500 underline-offset-4 hover:underline dark:text-dark-text/60"
      >
        返回泡馆
      </Link>
    </main>
  );
}
