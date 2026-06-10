"use client";
import { useAuth, useUI } from "@/lib/store";
import { Lock } from "lucide-react";

/** 二级个人页登录守卫：未登录显示引导，登录后显示内容。 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const openLogin = useUI((s) => s.openLogin);

  if (!hydrated) {
    return <div className="p-8 text-center text-sm text-ink-300">加载中…</div>;
  }
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-celadon-soft dark:bg-celadon/15">
          <Lock className="text-celadon" size={34} strokeWidth={1.5} />
        </div>
        <p className="font-serif text-lg text-ink dark:text-dark-text">登录后查看</p>
        <p className="mt-1.5 text-sm text-ink-500 dark:text-dark-text/60">登录即可同步你的收藏、笔记与书评</p>
        <button
          onClick={() => openLogin()}
          className="mt-6 rounded-full bg-celadon px-6 py-2.5 text-sm text-snow shadow-celadon active:scale-95"
        >
          登录 / 注册
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
