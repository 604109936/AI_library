"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** 二级页通用顶栏：返回箭头 + 居中标题 + 右侧操作。不含底部栏。 */
export function Header({
  title,
  right,
  transparent,
  className,
}: {
  title?: string;
  right?: React.ReactNode;
  transparent?: boolean;
  className?: string;
}) {
  const router = useRouter();
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center px-2",
        transparent ? "bg-transparent" : "bg-moon/90 backdrop-blur dark:bg-dark-bg/90",
        className
      )}
    >
      <button
        onClick={() => router.back()}
        className="flex h-10 w-10 items-center justify-center rounded-full active:bg-line/50"
        aria-label="返回"
      >
        <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
      </button>
      {title && (
        <h1 className="flex-1 text-center font-serif text-lg text-ink dark:text-dark-text">
          {title}
        </h1>
      )}
      {!title && <div className="flex-1" />}
      <div className="flex h-10 min-w-10 items-center justify-end pr-1">{right}</div>
    </header>
  );
}
