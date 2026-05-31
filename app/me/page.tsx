"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, BookMarked, Settings, LogOut, Clock, BookOpen, NotebookPen, Star } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useAuth, useLibrary, useUI } from "@/lib/store";
import { isFinished } from "@/lib/utils";

export default function MePage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const logout = useAuth((s) => s.logout);
  const openLogin = useUI((s) => s.openLogin);
  const toast = useUI((s) => s.toast);
  // 订阅库数据，使首页统计随子页增删实时一致（F12）
  const notes = useLibrary((s) => s.notes);
  const myReviews = useLibrary((s) => s.myReviews);
  const history = useLibrary((s) => s.history);
  const libHydrated = useLibrary((s) => s.hydrated);
  const [confirmOut, setConfirmOut] = useState(false);

  // 两套数据都水合后再显数字，避免首帧闪 0/—
  const ready = hydrated && libHydrated && !!user;
  const stats = [
    // 总时长暂无真实数据源，沿用 mock；无落地页（href: undefined → 渲染为静态 div）
    { label: "总时长", value: user ? `${user.stats.hours}h` : "—", icon: Clock, href: undefined as string | undefined },
    // 「已读」口径与子页对齐：用统一 isFinished 判定读完的书数（F74）
    { label: "已读", value: ready ? String(history.filter((h) => isFinished(h.progress)).length) : "—", icon: BookOpen, href: "/me/history" },
    { label: "笔记", value: ready ? String(notes.length) : "—", icon: NotebookPen, href: "/me/notes" },
    { label: "书评", value: ready ? String(myReviews.length) : "—", icon: Star, href: "/me/reviews" },
  ];

  // F13：删除与「设置」href 重复的「关于」项（关于内容已在设置页内）
  const menu = [
    { icon: BookMarked, label: "我的收藏", href: "/me/favorites" },
    { icon: Settings, label: "设置", href: "/me/settings" },
  ];

  return (
    <main className="min-h-[100dvh] pb-24">
      {/* 头部（竹影装饰背景） */}
      <div className="relative overflow-hidden bg-snow px-5 pb-6 pt-[calc(env(safe-area-inset-top)+3rem)] dark:bg-dark-card">
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

        {/* 数据卡：无 href 的「总时长」渲染为静态 div（消除伪可点死区，F74） */}
        <div className="relative mt-5 grid grid-cols-4 gap-2">
          {stats.map((st) => {
            const Icon = st.icon;
            const cls = "flex flex-col items-center rounded-xl bg-moon py-3 dark:bg-dark-bg";
            const inner = (
              <>
                <Icon size={15} className="text-celadon-700 dark:text-celadon-300" />
                <p className="mt-1 font-serif text-lg leading-none text-ink dark:text-dark-text">{st.value}</p>
                <p className="mt-1 text-caption text-ink-500 dark:text-dark-text/55">{st.label}</p>
              </>
            );
            if (!st.href) return <div key={st.label} className={cls}>{inner}</div>;
            return (
              <Link
                key={st.label}
                href={user ? st.href : "#"}
                onClick={(e) => { if (!user) { e.preventDefault(); openLogin(); } }}
                className={cls + " active:scale-[0.97]"}
              >
                {inner}
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

      {/* 退出二次确认（统一用 BottomSheet：遮罩/滚动锁定/ESC/焦点/底部安全区，F61） */}
      <BottomSheet open={confirmOut} onClose={() => setConfirmOut(false)} label="退出登录确认">
        <p className="text-center text-sm text-ink dark:text-dark-text">确认退出登录？</p>
        <p className="mt-1 text-center text-xs text-ink-500 dark:text-dark-text/55">退出后本地的收藏、笔记将清空</p>
        <div className="mt-4 flex gap-3">
          <button onClick={() => setConfirmOut(false)} className="flex-1 rounded-2xl bg-moon py-3 text-sm text-ink-700 dark:bg-dark-bg dark:text-dark-text/80">取消</button>
          <button onClick={() => { logout(); setConfirmOut(false); toast("已退出登录"); }} className="flex-1 rounded-2xl bg-rouge py-3 text-sm text-snow">退出</button>
        </div>
      </BottomSheet>

      <BottomNav active="me" />
    </main>
  );
}
