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

/** 唯一的底部导航。仅在四个根页面挂载；二级页不渲染本组件。
 *  variant="dark"：用于乱翻沉浸态，半透明深色玻璃底，不破坏暗调氛围。 */
export function BottomNav({ active, variant = "light" }: { active: TabKey; variant?: "light" | "dark" }) {
  const dark = variant === "dark";
  return (
    <nav
      className={cn(
        "app-width fixed bottom-0 left-1/2 z-40 -translate-x-1/2 border-t pb-safe backdrop-blur",
        dark
          ? "border-white/10 bg-black/35"
          : "border-line bg-snow/95 dark:border-white/5 dark:bg-dark-card/95"
      )}
    >
      <div className="grid grid-cols-4">
        {TABS.map(({ key, label, href, Icon }) => {
          const on = key === active;
          const onColor = "text-celadon";
          const offColor = dark ? "text-white/70" : "text-ink-300";
          return (
            <Link
              key={key}
              href={href}
              aria-current={on ? "page" : undefined}
              aria-label={label}
              className="relative flex flex-col items-center gap-1 py-2.5 transition-transform active:scale-90"
            >
              {/* 选中条：切页是整页跳转，layoutId 跨页动画无效，改为本地浮现动画 */}
              {on && <span className="absolute top-0 h-0.5 w-7 animate-scale-in rounded-full bg-celadon" />}
              <Icon
                size={22}
                strokeWidth={on ? 2.4 : 1.8}
                className={cn("transition-colors", on ? onColor : offColor)}
              />
              <span
                className={cn(
                  "text-[11px] leading-none transition-colors",
                  on ? "font-medium " + onColor : offColor
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
