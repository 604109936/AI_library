"use client";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useUI, useReader, type Theme, type ReaderBg } from "@/lib/store";
import type { ReadingMode } from "@/lib/types";

const THEMES: { key: Theme; label: string }[] = [
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
  { key: "system", label: "跟随系统" },
];

// 阅读模式术语统一（F14）：全 APP 口径对齐为「视频/音频/原文」，与详情页播放器、阅读历史一致，避免「听书/文字」并存的歧义
const READING_MODE_LABEL: Record<ReadingMode, string> = { video: "视频", audio: "音频", text: "原文" };
const READING_MODE_OPTIONS = (["video", "audio", "text"] as ReadingMode[]).map((v) => ({ v, t: READING_MODE_LABEL[v] }));

export default function SettingsPage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const notify = useUI((s) => s.notify);
  const setNotify = useUI((s) => s.setNotify);
  const toast = useUI((s) => s.toast);
  const reader = useReader();

  return (
    <main className="relative min-h-[100dvh] pb-10">
      <Header title="设置" />
      <Motif name="branch" className="pointer-events-none absolute right-3 top-1 h-16 w-16 text-celadon/30" />
      <RequireAuth>
        <div className="space-y-5 p-4">
          {/* 个人信息 */}
          <Group title="个人信息">
            <button onClick={() => router.push("/me/settings/profile")} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 dark:border-white/5">
              <span className="flex-1 text-left text-sm text-ink dark:text-dark-text">头像</span>
              <Avatar seed={user?.avatarSeed ?? 7} name={user?.nickname} src={user?.avatarUrl} size={28} />
              <ChevronRight size={16} className="text-ink-300" />
            </button>
            <Item label="昵称" value={user?.nickname} onClick={() => router.push("/me/settings/profile")} />
            <Item label="简介" value={user?.bio} onClick={() => router.push("/me/settings/profile")} />
            <Item label="修改密码" onClick={() => toast("修改密码功能即将上线", "info")} />
          </Group>

          {/* 阅读偏好 */}
          <Group title="阅读偏好">
            <SegRow label="默认阅读模式" value={reader.defaultMode} options={READING_MODE_OPTIONS} onPick={(v) => reader.setDefaultMode(v as ReadingMode)} />
            <SegRow label="默认字号" value={reader.fontSize} options={[
              { v: 16, t: "小" }, { v: 18, t: "中" }, { v: 20, t: "大" }, { v: 22, t: "超大" },
            ]} onPick={(v) => reader.setFontSize(v as number)} />
            <SegRow label="默认背景" value={reader.bg} options={[
              { v: "white", t: "白" }, { v: "moon", t: "米黄" }, { v: "green", t: "护眼" }, { v: "dark", t: "深灰" },
            ]} onPick={(v) => reader.setBg(v as ReaderBg)} />
          </Group>

          {/* 主题 */}
          <Group title="主题模式">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-ink dark:text-dark-text">外观</span>
              <div className="flex overflow-hidden rounded-full bg-moon dark:bg-dark-bg">
                {THEMES.map((t) => (
                  <button key={t.key} onClick={() => setTheme(t.key)} aria-pressed={theme === t.key} className={"px-3 py-1.5 text-xs " + (theme === t.key ? "bg-celadon text-snow" : "text-ink-500 dark:text-dark-text/60")}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </Group>

          {/* 通知 */}
          {/* F73：仅校正显示文案令其与底层字段语义一致并统一「提醒」结尾——push=即时推送→新书上线提醒；weekly=每周聚合→每周精选提醒。
              不改 persist 字段名（push/weekly），避免旧缓存键失配的迁移风险。 */}
          <Group title="通知设置">
            <Toggle label="新书上线提醒" on={notify.push} onToggle={() => setNotify({ push: !notify.push })} />
            <Toggle label="每周精选提醒" on={notify.weekly} onToggle={() => setNotify({ weekly: !notify.weekly })} />
          </Group>

          {/* 隐私与数据 */}
          <Group title="隐私与数据">
            <Item label="导出我的数据" onClick={() => toast("数据导出已开始", "info")} />
            <Item label="注销账号" danger onClick={() => toast("注销需二次确认，30 天后硬删除", "info")} />
          </Group>

          {/* 关于 */}
          <Group title="关于">
            <Item label="版本" value="v1.0.0" />
            {/* F72：协议/隐私/反馈尚未落地，统一对齐「即将上线」措辞，不再把 label 当 toast 回显造成「点了等于没点」 */}
            <Item label="用户协议" onClick={() => toast("用户协议即将上线", "info")} />
            <Item label="隐私政策" onClick={() => toast("隐私政策即将上线", "info")} />
            <Item label="意见反馈" onClick={() => toast("意见反馈功能即将上线", "info")} />
          </Group>
        </div>
      </RequireAuth>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-1 text-xs text-ink-500 dark:text-dark-text/55">{title}</p>
      <div className="overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">{children}</div>
    </div>
  );
}
function Item({ label, value, danger, onClick }: { label: string; value?: string; danger?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 last:border-0 active:bg-moon/60 dark:border-white/5 dark:active:bg-dark-bg">
      <span className={"shrink-0 text-left text-sm " + (danger ? "text-rouge" : "text-ink dark:text-dark-text")}>{label}</span>
      {value && <span className="ml-auto max-w-[55%] truncate text-xs text-ink-500 dark:text-dark-text/55">{value}</span>}
      {onClick && <ChevronRight size={16} className={"text-ink-300 " + (value ? "" : "ml-auto")} />}
    </button>
  );
}
function SegRow({ label, value, options, onPick }: { label: string; value: string | number; options: { v: string | number; t: string }[]; onPick: (v: string | number) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0 dark:border-white/5">
      <span className="text-sm text-ink dark:text-dark-text">{label}</span>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button key={String(o.v)} onClick={() => onPick(o.v)} aria-pressed={value === o.v} className={"rounded-lg px-2.5 py-1 text-xs " + (value === o.v ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg dark:text-dark-text/60")}>{o.t}</button>
        ))}
      </div>
    </div>
  );
}
function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3.5 last:border-0 dark:border-white/5">
      <span className="text-sm text-ink dark:text-dark-text">{label}</span>
      <button onClick={onToggle} role="switch" aria-checked={on} aria-label={label} className={"relative h-6 w-11 rounded-full transition " + (on ? "bg-celadon" : "bg-line dark:bg-white/15")}>
        <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all " + (on ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}
