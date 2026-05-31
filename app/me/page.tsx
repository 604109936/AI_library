"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, BookMarked, Settings, Info, LogOut, Clock, BookOpen, NotebookPen, Star } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useLibrary, useUI } from "@/lib/store";

export default function MePage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const logout = useAuth((s) => s.logout);
  const openLogin = useUI((s) => s.openLogin);
  const toast = useUI((s) => s.toast);
  const [confirmOut, setConfirmOut] = useState(false);

  const s = user?.stats;
  const stats = [
    { label: "总时长", value: s ? `${s.hours}h` : "—", icon: Clock, href: undefined as string | undefined },
    { label: "已读", value: s ? String(s.read) : "—", icon: BookOpen, href: "/me/history" },
    { label: "笔记", value: s ? String(s.notes) : "—", icon: NotebookPen, href: "/me/notes" },
    { label: "书评", value: s ? String(s.reviews) : "—", icon: Star, href: "/me/reviews" },
  ];

  const menu = [
    { icon: BookMarked, label: "我的收藏", href: "/me/favorites" },
    { icon: Settings, label: "设置", href: "/me/settings" },
    { icon: Info, label: "关于", href: "/me/settings" },
  ];

  return (
    <main className="min-h-[100dvh] pb-24">
      {/* 头部（竹影装饰背景） */}
      <div className="relative overflow-hidden bg-snow px-5 pb-6 pt-12 dark:bg-dark-card">
        <Motif name="bamboo" className="pointer-events-none absolute -left-2 top-0 h-24 w-24 text-celadon/25" />
        <Motif name="branch" className="pointer-events-none absolute right-0 top-1 h-24 w-24 text-celadon/25" />

        {hydrated && user ? (
          <motion.button
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26 }}
            onClick={() => router.push("/me/settings/profile")}
            className="relative flex w-full flex-col items-center text-center"
          >
            <Avatar seed={user.avatarSeed} name={user.nickname} src={user.avatarUrl} size={76} ring />
            <p className="mt-3 font-serif text-xl text-ink dark:text-dark-text">{user.nickname}</p>
            <p className="mt-1 text-sm text-ink-500 dark:text-dark-text/55">{user.bio}</p>
            <span className="mt-1.5 text-xs text-celadon-700 dark:text-celadon-300">编辑资料</span>
          </motion.button>
        ) : (
          <button onClick={() => openLogin()} className="relative flex w-full flex-col items-center text-center">
            <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-celadon-soft font-serif text-2xl text-celadon-700 ring-2 ring-celadon/40 ring-offset-2 ring-offset-snow dark:bg-celadon/20 dark:text-celadon-300 dark:ring-offset-dark-card">读</span>
            <p className="mt-3 font-serif text-xl text-ink dark:text-dark-text">登录 / 注册</p>
            <p className="mt-1 text-sm text-ink-500 dark:text-dark-text/55">同步你的收藏、笔记与书评</p>
          </button>
        )}

        {/* 数据卡 */}
        <div className="relative mt-5 grid grid-cols-4 gap-2">
          {stats.map((st) => {
            const Icon = st.icon;
            return (
              <Link
                key={st.label}
                href={user && st.href ? st.href : "#"}
                onClick={(e) => { if (!user || !st.href) { e.preventDefault(); if (!user) openLogin(); } }}
                className="flex flex-col items-center rounded-xl bg-moon py-3 dark:bg-dark-bg"
              >
                <Icon size={15} className="text-celadon-700 dark:text-celadon-300" />
                <p className="mt-1 font-serif text-lg leading-none text-ink dark:text-dark-text">{st.value}</p>
                <p className="mt-1 text-[11px] text-ink-300">{st.label}</p>
              </Link>
            );
          })}
        </div>
      </div>

      {/* 菜单 */}
      <div className="mx-4 mt-4 overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">
        {menu.map(({ icon: Icon, label, href }, i) => (
          <Link
            key={label}
            href={href}
            className={"flex items-center gap-3 px-4 py-3.5 active:bg-moon/60 dark:active:bg-dark-bg " + (i ? "border-t border-line dark:border-white/5" : "")}
          >
            <Icon size={18} className="text-celadon-700 dark:text-celadon-300" />
            <span className="flex-1 text-sm text-ink dark:text-dark-text">{label}</span>
            <ChevronRight size={16} className="text-ink-300" />
          </Link>
        ))}
        {user && (
          <button
            onClick={() => setConfirmOut(true)}
            className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 active:bg-moon/60 dark:border-white/5 dark:active:bg-dark-bg"
          >
            <LogOut size={18} className="text-rouge" />
            <span className="flex-1 text-left text-sm text-rouge">退出登录</span>
          </button>
        )}
      </div>

      <Motif name="mountain" className="mx-auto mt-8 h-14 w-56 text-celadon/20" />

      {/* 退出二次确认 */}
      <AnimatePresence>
        {confirmOut && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setConfirmOut(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 dark:bg-dark-card">
              <p className="text-center text-sm text-ink dark:text-dark-text">确认退出登录？</p>
              <p className="mt-1 text-center text-xs text-ink-300">退出后本地的收藏、笔记将清空</p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => setConfirmOut(false)} className="flex-1 rounded-2xl bg-moon py-3 text-sm text-ink-700 dark:bg-dark-bg dark:text-dark-text/80">取消</button>
                <button onClick={() => { logout(); setConfirmOut(false); toast("已退出登录"); }} className="flex-1 rounded-2xl bg-rouge py-3 text-sm text-snow">退出</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNav active="me" />
    </main>
  );
}
