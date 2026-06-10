"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronRight, Heart, Settings, Info, Clock, BookOpen, BookCheck, Star, NotebookPen } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useLibrary, useUI } from "@/lib/store";

/** 图书馆开灯 / 关灯：可拖拽的拉绳台灯。下拉拉绳松开即切换 日间(浅) / 夜间(深)，附激励提示 */
function LampPull() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const toast = useUI((s) => s.toast);
  const on = theme !== "dark";
  function toggle() {
    const next = on ? "dark" : "light";
    setTheme(next);
    toast(next === "light" ? "灯亮了，开启今天的阅读时光 ☀" : "灯熄了，今天辛苦啦，明天继续 🌙", "info");
  }
  return (
    <div className="absolute right-5 top-0 z-20 flex flex-col items-center">
      {/* 灯罩 + 灯泡光 */}
      <div className="relative flex flex-col items-center">
        <div className={"h-0 w-0 border-l-[15px] border-r-[15px] border-b-[18px] border-l-transparent border-r-transparent transition-colors duration-500 " + (on ? "border-b-celadon-700" : "border-b-ink-300/50 dark:border-b-white/20")} />
        <div className={"-mt-[3px] h-[6px] w-[34px] rounded-b-md transition-colors duration-500 " + (on ? "bg-celadon" : "bg-ink-300/40 dark:bg-white/15")} />
        <div className={"mt-0.5 h-3 w-3 rounded-full transition-all duration-500 " + (on ? "bg-brass shadow-[0_0_22px_8px_rgba(184,155,110,0.6)]" : "bg-ink-300/40 dark:bg-white/15")} />
      </div>
      {/* 固定绳段 */}
      <div className="h-4 w-px bg-ink/25 dark:bg-white/25" />
      {/* 可拖拽拉绳 + 拉环 */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.7}
        dragSnapToOrigin
        onDragEnd={(_, info) => { if (info.offset.y > 22) toggle(); }}
        whileDrag={{ cursor: "grabbing" }}
        aria-label={on ? "拉绳关灯" : "拉绳开灯"}
        className="flex cursor-grab touch-none flex-col items-center pb-4"
      >
        <div className="h-7 w-px bg-ink/25 dark:bg-white/25" />
        <div className={"h-4 w-4 rounded-full border-2 bg-snow transition-colors dark:bg-dark-card " + (on ? "border-brass" : "border-ink-300 dark:border-white/30")} />
      </motion.div>
    </div>
  );
}

export default function MePage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const openLogin = useUI((s) => s.openLogin);
  const history = useLibrary((s) => s.history);
  const favorites = useLibrary((s) => s.favorites);

  const readSeconds = useLibrary((s) => s.readSeconds);
  // 总时长=真实累计阅读/收听时长（音视频+文字之和）
  const durLabel = readSeconds >= 3600 ? `${(readSeconds / 3600).toFixed(1)}h` : `${Math.floor(readSeconds / 60)}分`;
  // 已读/进行中均按「书」统计数量，同一本书音视频+文字稿不重复计数
  const doneBooks = new Set(history.filter((h) => h.progress >= 100).map((h) => h.bookId));
  const readCount = doneBooks.size; // 已读=任一模式读完的书（去重）
  // 进行中=有进度但未读完的书（按书去重）；同书若已读完则不再计入进行中
  const ongoingBooks = new Set(history.filter((h) => h.progress < 100).map((h) => h.bookId));
  doneBooks.forEach((id) => ongoingBooks.delete(id));
  const ongoing = ongoingBooks.size;
  // 数据卡入口带上「有记录的大类」作为历史页默认筛选：避免卡上"已读 1"，点进去却因默认音视频筛选而显示空态
  const modeFor = (done: boolean) => {
    const rows = history.filter((h) => (done ? h.progress >= 100 : h.progress < 100));
    const hasAv = rows.some((h) => h.mode !== "text");
    return hasAv ? "av" : rows.some((h) => h.mode === "text") ? "text" : "av";
  };
  const stats = [
    { label: "总时长", value: user ? durLabel : "—", icon: Clock, href: undefined as string | undefined },
    { label: "已读", value: user ? String(readCount) : "—", icon: BookCheck, href: `/me/history?status=read&mode=${modeFor(true)}` },
    { label: "进行中", value: user ? String(ongoing) : "—", icon: BookOpen, href: `/me/history?status=reading&mode=${modeFor(false)}` },
    { label: "收藏", value: user ? String(favorites.length) : "—", icon: Heart, href: "/me/favorites" },
  ];

  const menu = [
    { icon: Star, label: "我的书评", href: "/me/reviews", auth: true },
    { icon: NotebookPen, label: "我的笔记", href: "/me/notes", auth: true },
    { icon: Settings, label: "设置", href: "/me/settings", auth: false },
    { icon: Info, label: "关于", href: "/me/legal?doc=about", auth: false },
  ];

  return (
    <main className="min-h-[100dvh] pb-24">
      {/* 头部（竹影装饰 + 拉绳台灯开关灯） */}
      <div className="relative overflow-hidden bg-snow px-5 pb-6 pt-12 dark:bg-dark-card">
        <Motif name="bamboo" className="pointer-events-none absolute -left-2 top-0 h-24 w-24 text-celadon/25" />
        <LampPull />

        {hydrated && user ? (
          <motion.button
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
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

        {/* 数据卡：总时长 / 已读 / 进行中 / 收藏 */}
        <div className="relative mt-5 grid grid-cols-4 gap-2">
          {stats.map((st) => {
            const Icon = st.icon;
            const cls = "flex flex-col items-center rounded-xl bg-moon py-3 dark:bg-dark-bg";
            const inner = (
              <>
                <Icon size={15} className="text-celadon-700 dark:text-celadon-300" />
                <p className="mt-1 font-serif text-lg leading-none text-ink dark:text-dark-text">{st.value}</p>
                <p className="mt-1 text-[11px] text-ink-300">{st.label}</p>
              </>
            );
            if (!st.href) return <div key={st.label} className={cls}>{inner}</div>;
            return (
              <Link key={st.label} href={user ? st.href : "#"} onClick={(e) => { if (!user) { e.preventDefault(); openLogin(); } }} className={cls}>
                {inner}
              </Link>
            );
          })}
        </div>
      </div>

      {/* 菜单：我的书评 / 我的笔记 / 设置 / 关于 */}
      <div className="mx-4 mt-4 overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">
        {menu.map(({ icon: Icon, label, href, auth }, i) => (
          <Link
            key={label}
            href={!auth || user ? href : "#"}
            onClick={(e) => { if (auth && !user) { e.preventDefault(); openLogin(); } }}
            className={"flex items-center gap-3 px-4 py-3.5 active:bg-moon/60 dark:active:bg-dark-bg " + (i ? "border-t border-line dark:border-white/5" : "")}
          >
            <Icon size={18} className="text-celadon-700 dark:text-celadon-300" />
            <span className="flex-1 text-sm text-ink dark:text-dark-text">{label}</span>
            <ChevronRight size={16} className="text-ink-300" />
          </Link>
        ))}
      </div>

      <Motif name="mountain" className="mx-auto mt-8 h-14 w-56 text-celadon/20" />

      <BottomNav active="me" />
    </main>
  );
}
