"use client";
import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { ChevronRight, Heart, Settings, Info, Clock, BookOpen, BookCheck, Star, NotebookPen } from "lucide-react";
import { BottomNav } from "@/components/shell/BottomNav";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useLibrary, useUI } from "@/lib/store";

/** 图书馆「掌灯 / 熄灯」：垂下的拉绳灯。向下拉拽拉绳——绳子随手连续变长、松手回弹（生活常识，线只会变长不会断），
    松手即在 浅色(掌灯) / 深色(熄灯) 间切换，灯泡随之亮起 / 黯下，附一句应景提示，给"开始读书 / 该歇息了"的小仪式感。
    轻点拉环也可直接切换。 */
function LampPull() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const toast = useUI((s) => s.toast);
  const on = theme !== "dark";
  const pull = useMotionValue(0); // 拉绳被拉下的距离（px）
  const cordH = useTransform(pull, (v) => 26 + v); // 绳长 = 固定段 + 拉拽量：连续伸长，永不断开
  const bulb = useTransform(pull, [0, 56], [1, 1.22]); // 拉到位时灯泡微微胀大，给"将触发"的预感
  const dragging = useRef(false);
  const startY = useRef(0);
  const TRIGGER = 30; // 拉过此距离松手即切换

  function toggle() {
    const next = on ? "dark" : "light";
    setTheme(next);
    // 同组 key "theme"：连点开 / 关灯只显示最新一条提示，不再叠两条（用户反馈）
    toast(next === "light" ? "掌灯启卷" : "掩卷熄灯", "info", undefined, "theme");
  }
  function onDown(e: React.PointerEvent) {
    dragging.current = true;
    startY.current = e.clientY;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }
  function onMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    pull.set(Math.max(0, Math.min(64, e.clientY - startY.current))); // 跟手下拉，封顶 64px
  }
  function onUp() {
    if (!dragging.current) return;
    dragging.current = false;
    const v = pull.get();
    animate(pull, 0, { type: "spring", stiffness: 700, damping: 30 }); // 松手回弹（皮筋感）
    if (v >= TRIGGER || v < 4) toggle(); // 拉到位 / 轻点 → 切换；半截犹豫(4~30) → 回弹不切
  }

  return (
    <div className="absolute right-4 top-0 z-20 flex select-none flex-col items-center">
      {/* 灯：罩 + 座 + 泡（亮时暖黄辉光，熄时黯淡）；拉拽时灯泡轻胀预告切换 */}
      <div className="relative flex flex-col items-center">
        {on && <span className="pointer-events-none absolute left-1/2 top-4 h-9 w-9 -translate-x-1/2 rounded-full bg-brass/30 blur-xl" />}
        <div className={"h-0 w-0 border-l-[14px] border-r-[14px] border-b-[17px] border-l-transparent border-r-transparent transition-colors duration-500 " + (on ? "border-b-celadon-700" : "border-b-ink-300/45 dark:border-b-white/20")} />
        <div className={"-mt-[3px] h-[6px] w-[32px] rounded-b-md transition-colors duration-500 " + (on ? "bg-celadon" : "bg-ink-300/40 dark:bg-white/15")} />
        <motion.div style={{ scale: bulb }} className={"relative z-10 mt-0.5 h-3 w-3 rounded-full transition-[background-color,box-shadow] duration-500 " + (on ? "bg-brass shadow-[0_0_22px_7px_rgba(184,155,110,0.65)]" : "bg-ink-300/35 dark:bg-white/15")} />
      </div>
      {/* 一整根拉绳：高度随拉拽连续增长（绳只会变长、不会断）；绳尾拉环被带着下垂，跟手 */}
      <motion.div style={{ height: cordH }} className="w-[1.5px] bg-ink/25 dark:bg-white/25" />
      <button
        type="button"
        aria-label={on ? "拉绳熄灯" : "拉绳掌灯"}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="-mt-px flex touch-none cursor-grab flex-col items-center pb-5 active:cursor-grabbing"
      >
        {/* 拉环（亮时铜环、熄时素环） */}
        <span className={"h-4 w-4 rounded-full border-2 bg-snow transition-colors dark:bg-dark-card " + (on ? "border-brass" : "border-ink-300 dark:border-white/30")} />
      </button>
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
  const libHydrated = useLibrary((s) => s.hydrated); // 登录后数据加载完成才显示统计，避免窗口期闪 0（Bug#20）

  const readSeconds = useLibrary((s) => s.readSeconds);
  // 阅读时长=真实累计阅读/收听时长（音视频+文字之和）
  const durLabel = readSeconds >= 3600 ? `${(readSeconds / 3600).toFixed(1)}h` : `${Math.floor(readSeconds / 60)}分`;
  // 已读/进行中均按「书」统计数量，同一本书音视频+文字稿不重复计数
  const doneBooks = new Set(history.filter((h) => h.progress >= 100).map((h) => h.bookId));
  const readCount = doneBooks.size; // 已读=任一模式读完的书（去重）
  // 进行中=任一模式（文字稿或音视频）正在读（0<进度<100）的书，按书去重（同书两边都在读也只计 1）。
  // 排除 0%（打开过没读=未读）。不因"另一模式已读完"而排除——如视频看完后又在读文字稿，这本仍算进行中（用户口径）。
  const ongoing = new Set(history.filter((h) => h.progress > 0 && h.progress < 100).map((h) => h.bookId)).size;
  // 登录态 + 库数据已水合 才显示真值，否则占位"—"：避免登录/冷启动恢复会话瞬间四卡先闪 0 再跳真值（Bug#20）
  const ready = !!user && libHydrated;
  const stats = [
    { label: "阅读时长", value: ready ? durLabel : "—", icon: Clock, href: undefined as string | undefined },
    { label: "已读", value: ready ? String(readCount) : "—", icon: BookCheck, href: `/me/history?status=read` },
    { label: "进行中", value: ready ? String(ongoing) : "—", icon: BookOpen, href: `/me/history?status=reading` },
    { label: "收藏", value: ready ? String(favorites.length) : "—", icon: Heart, href: "/me/favorites" },
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

        {/* 头部三态：user 就绪即显示（不等整条加载链）→ 未就绪且未水合给骨架 → 确认未登录才给 CTA。
            原「hydrated && user」会让已登录用户冷启动慢网下闪现几秒"登录 / 注册"，点了还真弹登录抽屉 */}
        {user ? (
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
        ) : !hydrated ? (
          <div className="relative flex w-full flex-col items-center text-center" aria-hidden>
            <span className="h-[76px] w-[76px] animate-pulse rounded-full bg-moon dark:bg-dark-bg" />
            <span className="mt-3 h-6 w-28 animate-pulse rounded-md bg-moon dark:bg-dark-bg" />
            <span className="mt-2 h-4 w-44 animate-pulse rounded-md bg-moon dark:bg-dark-bg" />
          </div>
        ) : (
          <button onClick={() => openLogin()} className="relative flex w-full flex-col items-center text-center">
            <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-celadon-soft font-serif text-2xl text-celadon-700 ring-2 ring-celadon/40 ring-offset-2 ring-offset-snow dark:bg-celadon/20 dark:text-celadon-300 dark:ring-offset-dark-card">读</span>
            <p className="mt-3 font-serif text-xl text-ink dark:text-dark-text">登录 / 注册</p>
            <p className="mt-1 text-sm text-ink-500 dark:text-dark-text/55">同步你的收藏、笔记与书评</p>
          </button>
        )}

        {/* 数据卡：阅读时长 / 已读 / 进行中 / 收藏 */}
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
            const href = st.href;
            return (
              // 未登录点击：挂起目标路由，登录成功后自动跳过去（不再停在原地要用户再点一次）
              <Link key={st.label} href={user ? href : "#"} onClick={(e) => { if (!user) { e.preventDefault(); openLogin(() => router.push(href)); } }} className={cls}>
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
            onClick={(e) => { if (auth && !user) { e.preventDefault(); openLogin(() => router.push(href)); } }}
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
