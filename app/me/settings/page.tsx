"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { useUI, useReader, type Theme, type ReaderBg } from "@/lib/store";

const THEMES: { key: Theme; label: string }[] = [
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
  { key: "system", label: "跟随系统" },
];

export default function SettingsPage() {
  const router = useRouter();
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const toast = useUI((s) => s.toast);
  const reader = useReader();

  return (
    <main className="min-h-[100dvh] pb-10">
      <Header title="设置" />
      <RequireAuth>
        <div className="space-y-5 p-4">
          {/* 个人信息 */}
          <Group title="个人信息">
            {["头像", "昵称", "简介", "修改密码"].map((label) => (
              <Item key={label} label={label} onClick={() => router.push("/me/settings/profile")} />
            ))}
          </Group>

          {/* 阅读偏好 */}
          <Group title="阅读偏好">
            <SegRow label="默认字号" value={reader.fontSize} options={[
              { v: 16, t: "小" }, { v: 18, t: "中" }, { v: 20, t: "大" }, { v: 22, t: "超大" },
            ]} onPick={(v) => reader.setFontSize(v as number)} />
            <SegRow label="默认背景" value={reader.bg} options={[
              { v: "white", t: "白" }, { v: "moon", t: "米黄" }, { v: "green", t: "护眼" }, { v: "dark", t: "深灰" },
            ]} onPick={(v) => reader.setBg(v as ReaderBg)} />
            <SegRow label="翻页方式" value={reader.pageMode} options={[
              { v: "scroll", t: "滚动" }, { v: "page", t: "翻页" },
            ]} onPick={(v) => reader.setPageMode(v as "scroll" | "page")} />
          </Group>

          {/* 主题 */}
          <Group title="主题模式">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-ink dark:text-dark-text">外观</span>
              <div className="flex overflow-hidden rounded-full bg-moon dark:bg-dark-bg">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTheme(t.key)}
                    className={"px-3 py-1.5 text-xs " + (theme === t.key ? "bg-celadon text-snow" : "text-ink-500")}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </Group>

          {/* 通知 */}
          <Group title="通知设置">
            <Toggle label="新书上线提醒" />
            <Toggle label="书评互动通知" />
          </Group>

          {/* 隐私与数据 */}
          <Group title="隐私与数据">
            <Item label="导出我的数据" onClick={() => toast("数据导出已开始", "info")} />
            <Item label="注销账号" danger onClick={() => toast("注销需二次确认，30 天后硬删除", "info")} />
          </Group>

          {/* 关于 */}
          <Group title="关于">
            <Item label="版本" value="v1.0.0" />
            <Item label="用户协议" onClick={() => toast("用户协议", "info")} />
            <Item label="隐私政策" onClick={() => toast("隐私政策", "info")} />
            <Item label="意见反馈" onClick={() => toast("感谢反馈", "info")} />
          </Group>
        </div>
      </RequireAuth>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-1 text-xs text-ink-300">{title}</p>
      <div className="overflow-hidden rounded-xl bg-snow shadow-sm dark:bg-dark-card">{children}</div>
    </div>
  );
}
function Item({ label, value, danger, onClick }: { label: string; value?: string; danger?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 last:border-0 active:bg-moon/60 dark:active:bg-dark-bg">
      <span className={"flex-1 text-left text-sm " + (danger ? "text-rouge" : "text-ink dark:text-dark-text")}>{label}</span>
      {value && <span className="text-xs text-ink-300">{value}</span>}
      {onClick && !value && <ChevronRight size={16} className="text-ink-300" />}
    </button>
  );
}
function SegRow({ label, value, options, onPick }: { label: string; value: string | number; options: { v: string | number; t: string }[]; onPick: (v: string | number) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0">
      <span className="text-sm text-ink dark:text-dark-text">{label}</span>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button key={String(o.v)} onClick={() => onPick(o.v)} className={"rounded-lg px-2.5 py-1 text-xs " + (value === o.v ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg")}>{o.t}</button>
        ))}
      </div>
    </div>
  );
}
function Toggle({ label }: { label: string }) {
  const [on, setOn] = useState(true);
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3.5 last:border-0">
      <span className="text-sm text-ink dark:text-dark-text">{label}</span>
      <button onClick={() => setOn(!on)} className={"relative h-6 w-11 rounded-full transition " + (on ? "bg-celadon" : "bg-line")}>
        <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all " + (on ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}
