"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight, Settings, BookOpen, Palette, Bell, Info, LogOut, Clock, BookMarked, NotebookPen, Star,
} from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Avatar } from "@/components/ui/Avatar";
import { useAuth, useLibrary, useUI } from "@/lib/store";

export default function MePage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const logout = useAuth((s) => s.logout);
  const openLogin = useUI((s) => s.openLogin);
  const toast = useUI((s) => s.toast);
  const favorites = useLibrary((s) => s.favorites);
  const notes = useLibrary((s) => s.notes);
  const myReviews = useLibrary((s) => s.myReviews);

  const stats = [
    { label: "总时长", value: user ? "36h" : "—", href: undefined },
    { label: "已读", value: user ? "12" : "—", href: "/me/history" },
    { label: "笔记", value: user ? String(notes.length) : "—", href: "/me/notes" },
    { label: "书评", value: user ? String(myReviews.length) : "—", href: "/me/reviews" },
  ];

  const menu = [
    { icon: BookMarked, label: "我的收藏", href: "/me/favorites" },
    { icon: NotebookPen, label: "我的笔记", href: "/me/notes" },
    { icon: Star, label: "我的书评", href: "/me/reviews" },
    { icon: Clock, label: "阅读历史", href: "/me/history" },
    { icon: BookOpen, label: "阅读偏好", href: "/me/settings" },
    { icon: Palette, label: "主题模式", href: "/me/settings" },
    { icon: Bell, label: "通知设置", href: "/me/settings" },
    { icon: Settings, label: "账号设置", href: "/me/settings" },
    { icon: Info, label: "关于", href: "/me/settings" },
  ];

  return (
    <main className="min-h-[100dvh] pb-24">
      {/* 头部 */}
      <div className="bg-snow px-5 pt-10 pb-6 dark:bg-dark-card">
        {hydrated && user ? (
          <button onClick={() => router.push("/me/settings/profile")} className="flex w-full items-center gap-4 text-left">
            <Avatar seed={user.avatarSeed} name={user.nickname} size={60} />
            <div className="min-w-0 flex-1">
              <p className="font-serif text-xl text-ink dark:text-dark-text">{user.nickname}</p>
              <p className="mt-0.5 truncate text-sm text-ink-500">{user.bio}</p>
            </div>
            <ChevronRight size={18} className="text-ink-300" />
          </button>
        ) : (
          <button onClick={() => openLogin()} className="flex w-full items-center gap-4 text-left">
            <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-celadon-soft font-serif text-celadon-700">读</div>
            <div className="flex-1">
              <p className="font-serif text-xl text-ink dark:text-dark-text">登录 / 注册</p>
              <p className="mt-0.5 text-sm text-ink-500">同步你的收藏、笔记与书评</p>
            </div>
            <ChevronRight size={18} className="text-ink-300" />
          </button>
        )}

        {/* 数据卡 */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <Link
              key={s.label}
              href={user && s.href ? s.href : "#"}
              onClick={(e) => { if (!user) { e.preventDefault(); openLogin(); } }}
              className="rounded-xl bg-moon py-3 text-center dark:bg-dark-bg"
            >
              <p className="font-serif text-lg text-ink dark:text-dark-text">{s.value}</p>
              <p className="mt-0.5 text-[11px] text-ink-300">{s.label}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* 菜单 */}
      <div className="mx-4 mt-4 overflow-hidden rounded-xl bg-snow shadow-sm dark:bg-dark-card">
        {menu.map(({ icon: Icon, label, href }, i) => (
          <Link
            key={label}
            href={href}
            onClick={(e) => {
              const needLogin = ["我的收藏", "我的笔记", "我的书评", "阅读历史"].includes(label);
              if (needLogin && !user) { e.preventDefault(); openLogin(); }
            }}
            className={"flex items-center gap-3 px-4 py-3.5 active:bg-moon/60 dark:active:bg-dark-bg " + (i ? "border-t border-line" : "")}
          >
            <Icon size={18} className="text-celadon-700" />
            <span className="flex-1 text-sm text-ink dark:text-dark-text">{label}</span>
            <ChevronRight size={16} className="text-ink-300" />
          </Link>
        ))}
        {user && (
          <button
            onClick={() => { logout(); toast("已退出登录"); }}
            className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 active:bg-moon/60 dark:active:bg-dark-bg"
          >
            <LogOut size={18} className="text-rouge" />
            <span className="flex-1 text-left text-sm text-rouge">退出登录</span>
          </button>
        )}
      </div>

      <BottomNav active="me" />
    </main>
  );
}
