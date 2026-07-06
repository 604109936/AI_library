"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { getHome, getFlip } from "@/lib/api";
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
// 全局空闲预载（每次会话仅一次；BottomNav 在四个根页都挂载=天然全局入口）：
// ① 预取 getHome——泡馆首屏与智学欢迎区共用这份数据，一次两页暖；③ 到手后预热前8张封面图；
// ② 显式 prefetch 四个 Tab 的页面 JS（Link 生产环境自带视口内预取，这里兜底视口外/首帧）；
// ④ 空转一次乱翻书单查询：暖服务端与连接（结果不落页面缓存，进页仍现取但链路已热）。
// 全部 requestIdleCallback 空闲执行，不阻塞当前页；失败无感（进页照常现载）。
let preloadedOnce = false;
export function BottomNav({ active, variant = "light" }: { active: TabKey; variant?: "light" | "dark" }) {
  const dark = variant === "dark";
  const qc = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    if (preloadedOnce) return;
    preloadedOnce = true;
    const run = () => {
      TABS.forEach((t) => { try { router.prefetch(t.href); } catch {} });
      qc.prefetchQuery({ queryKey: ["home"], queryFn: getHome, staleTime: 10 * 60 * 1000 })
        .then(() => {
          const d = qc.getQueryData(["home"]) as { recommend?: { cover?: string }[] } | undefined;
          (d?.recommend ?? []).slice(0, 8).forEach((bk) => { if (bk.cover) { const im = new window.Image(); im.src = bk.cover; } });
        })
        .catch(() => {});
      getFlip([]).catch(() => {});
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) (window as unknown as { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 800);
    // eslint-disable-next-line
  }, []);
  return (
    <nav
      className={cn(
        "app-width fixed bottom-0 left-1/2 z-40 -translate-x-1/2 pb-safe backdrop-blur",
        dark ? "bg-black/35" : "bg-snow/95 dark:bg-dark-card/95"
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
