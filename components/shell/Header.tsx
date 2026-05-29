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
  titleShown = true,
}: {
  title?: string;
  right?: React.ReactNode;
  transparent?: boolean;
  className?: string;
  /** 标题是否显示（用于大标题滚动收起后再淡入顶栏标题）。默认 true。 */
  titleShown?: boolean;
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
      {title ? (
        <h1
          className={cn(
            "flex-1 truncate px-2 text-center font-serif text-lg text-ink transition-all duration-200 dark:text-dark-text",
            titleShown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0"
          )}
        >
          {title}
        </h1>
      ) : (
        <div className="flex-1" />
      )}
      <div className="flex h-10 min-w-10 items-center justify-end pr-1">{right}</div>
    </header>
  );
}
