"use client";
import Link from "next/link";
import { MessagesSquare, BookMarked, Clapperboard, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabKey = "chat" | "library" | "flip" | "me";

const TABS: { key: TabKey; label: string; href: string; Icon: typeof User }[] = [
  { key: "chat", label: "智学", href: "/chat", Icon: MessagesSquare },
  { key: "library", label: "泡馆", href: "/library", Icon: BookMarked },
  { key: "flip", label: "乱翻", href: "/flip", Icon: Clapperboard },
  { key: "me", label: "我的", href: "/me", Icon: User },
];

/** 唯一的底部导航。仅在四个根页面挂载；二级页不渲染本组件。 */
export function BottomNav({ active }: { active: TabKey }) {
  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-app -translate-x-1/2 border-t border-line bg-snow/95 pb-safe backdrop-blur dark:border-white/5 dark:bg-dark-card/95">
      <div className="grid grid-cols-4">
        {TABS.map(({ key, label, href, Icon }) => {
          const on = key === active;
          return (
            <Link
              key={key}
              href={href}
              className="relative flex flex-col items-center gap-1 py-2.5"
            >
              {on && (
                <span className="absolute top-0 h-0.5 w-7 rounded-full bg-celadon" />
              )}
              <Icon
                size={22}
                strokeWidth={on ? 2.4 : 1.8}
                className={on ? "text-celadon" : "text-ink-300"}
              />
              <span
                className={cn(
                  "text-[11px] leading-none",
                  on ? "font-medium text-celadon" : "text-ink-300"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
