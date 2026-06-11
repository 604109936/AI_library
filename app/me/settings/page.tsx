"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, LogOut } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useUI, useReader, type Theme, type ReaderBg } from "@/lib/store";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { supabase } from "@/lib/supabase/client";

const THEMES: { key: Theme; label: string }[] = [
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
];

type Sheet = null | "password" | "deactivate" | "feedback" | "logout";

export default function SettingsPage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const toast = useUI((s) => s.toast);
  const reader = useReader();
  const [sheet, setSheet] = useState<Sheet>(null);
  useLockBodyScroll(sheet !== null); // 弹层打开时锁定背景滚动

  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [feedback, setFeedback] = useState("");
  const [acting, setActing] = useState(false); // 改密/注销请求中（防重复提交）
  const pwdValid = oldPwd.length >= 6 && newPwd.length >= 6 && newPwd === confirmPwd;

  function close() {
    setSheet(null);
    setOldPwd(""); setNewPwd(""); setConfirmPwd(""); setFeedback("");
  }
  // 真实改密：先用原密码重新登录校验，再调 Auth 更新（Review P1：原实现是本地假成功）
  async function submitPwd() {
    if (!pwdValid || acting) return;
    setActing(true);
    try {
      const email = user?.email || user?.account || "";
      const { error: e1 } = await supabase.auth.signInWithPassword({ email, password: oldPwd });
      if (e1) { toast("原密码不正确", "error"); return; }
      const { error: e2 } = await supabase.auth.updateUser({ password: newPwd });
      if (e2) {
        toast(/different from the old/i.test(e2.message) ? "新密码不能与原密码相同" : "修改失败，请稍后重试", "error");
        return;
      }
      close();
      toast("密码已修改");
    } finally {
      setActing(false);
    }
  }
  // T4.4 反馈真落库：feedback 表只写不读（RLS 仅本人可写，无读策略 → 只有管理员能看）
  async function submitFeedback() {
    if (!feedback.trim() || acting) return;
    // 弹层在 RequireAuth 外：会话中途失效时要明确提示而非静默没反应（不关弹层，已写的内容不丢）
    if (!user) { toast("登录已失效，请重新登录", "error"); return; }
    setActing(true);
    try {
      const { error } = await supabase.from("feedback").insert({ user_id: user.id, content: feedback.trim() });
      if (error) { toast("提交失败，请稍后重试", "error"); return; }
      close();
      toast("感谢反馈，我们会认真查看");
    } finally {
      setActing(false);
    }
  }
  // 真实注销：云函数用 service_role 删 auth 账号（用户数据表全部 on delete cascade 级联清除）
  async function doDeactivate() {
    if (acting) return;
    setActing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { toast("登录态已失效，请重新登录", "error"); return; }
      const r = await fetch("/api/account/delete", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        toast(j?.error ?? "注销失败，请稍后重试", "error");
        return;
      }
      close();
      await logout().catch(() => {}); // 账号已删，signOut 失败也无妨，本地清理在 logout 内完成
      toast("账号已注销", "info");
      router.replace("/library");
    } catch {
      toast("注销失败，请检查网络后重试", "error");
    } finally {
      setActing(false);
    }
  }
  function doLogout() {
    close();
    logout();
    toast("已退出登录");
    router.replace("/me");
  }

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
            <Item label="修改密码" onClick={() => setSheet("password")} />
          </Group>

          {/* 阅读偏好 */}
          <Group title="阅读偏好">
            <SegRow label="默认字号" value={reader.fontSize} options={[
              { v: 16, t: "小" }, { v: 18, t: "中" }, { v: 20, t: "大" }, { v: 22, t: "超大" },
            ]} onPick={(v) => reader.setFontSize(v as number)} />
            <SegRow label="默认背景" value={reader.bg} options={[
              { v: "white", t: "白" }, { v: "moon", t: "米黄" }, { v: "green", t: "护眼" }, { v: "dark", t: "深灰" },
            ]} onPick={(v) => reader.setBg(v as ReaderBg)} />
          </Group>

          {/* 主题外观（仅浅色 / 深色） */}
          <Group title="主题外观">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-ink dark:text-dark-text">外观</span>
              <div className="flex overflow-hidden rounded-full bg-moon dark:bg-dark-bg">
                {THEMES.map((t) => (
                  <button key={t.key} onClick={() => setTheme(t.key)} className={"px-4 py-1.5 text-xs " + (theme === t.key ? "bg-celadon text-snow" : "text-ink-500 dark:text-dark-text/60")}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </Group>

          {/* 隐私与数据 */}
          <Group title="隐私与数据">
            <Item label="注销账号" danger onClick={() => setSheet("deactivate")} />
          </Group>

          {/* 关于 */}
          <Group title="关于">
            <Item label="版本" value="v1.0.0" />
            <Item label="用户协议" onClick={() => router.push("/me/legal?doc=terms")} />
            <Item label="隐私政策" onClick={() => router.push("/me/legal?doc=privacy")} />
            <Item label="意见反馈" onClick={() => setSheet("feedback")} />
          </Group>

          {/* 退出登录（移至设置页底部） */}
          <button
            onClick={() => setSheet("logout")}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-rouge/40 py-3 text-sm text-rouge active:scale-[0.99]"
          >
            <LogOut size={16} /> 退出登录
          </button>
        </div>
      </RequireAuth>

      {/* 底部弹层：改密 / 注销 / 反馈 / 退出 */}
      <AnimatePresence>
        {sheet && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={close} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 32 }} className="app-width relative rounded-t-[24px] bg-snow p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] dark:bg-dark-card">
              {sheet === "password" && (
                <>
                  <h3 className="mb-4 text-center font-serif text-base text-ink dark:text-dark-text">修改密码</h3>
                  <Field label="原密码" value={oldPwd} onChange={setOldPwd} placeholder="请输入原密码" />
                  <Field label="新密码" value={newPwd} onChange={setNewPwd} placeholder="至少 6 位" />
                  <Field label="确认新密码" value={confirmPwd} onChange={setConfirmPwd} placeholder="再次输入新密码" />
                  {newPwd && confirmPwd && newPwd !== confirmPwd && <p className="mb-2 text-xs text-rouge">两次输入的新密码不一致</p>}
                  <button onClick={submitPwd} disabled={!pwdValid || acting} className="mt-2 w-full rounded-2xl bg-celadon py-3 text-sm text-snow disabled:opacity-40 active:scale-[0.99]">{acting ? "修改中" : "确认修改"}</button>
                </>
              )}
              {sheet === "deactivate" && (
                <>
                  <h3 className="mb-2 text-center font-serif text-base text-rouge">注销账号</h3>
                  <p className="mb-4 text-center text-sm leading-6 text-ink-500 dark:text-dark-text/60">注销后账号将被永久删除，云端的收藏、笔记、书评、阅读记录与对话全部清除，且不可恢复。确定要注销吗？</p>
                  <button onClick={doDeactivate} disabled={acting} className="w-full rounded-2xl bg-rouge py-3 text-sm text-snow disabled:opacity-40 active:scale-[0.99]">{acting ? "注销中" : "确认注销"}</button>
                  <button onClick={close} className="mt-2 w-full rounded-2xl py-3 text-sm text-ink-500 dark:text-dark-text/60">再想想</button>
                </>
              )}
              {sheet === "feedback" && (
                <>
                  <h3 className="mb-3 text-center font-serif text-base text-ink dark:text-dark-text">意见反馈</h3>
                  <textarea autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value.slice(0, 500))} placeholder="说说你的想法或遇到的问题，我们会认真查看" className="h-28 w-full resize-none rounded-2xl border border-line bg-moon p-3 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-bg dark:text-dark-text" />
                  <button onClick={submitFeedback} disabled={!feedback.trim() || acting} className="mt-3 w-full rounded-2xl bg-celadon py-3 text-sm text-snow disabled:opacity-40 active:scale-[0.99]">{acting ? "提交中" : "提交反馈"}</button>
                </>
              )}
              {sheet === "logout" && (
                <>
                  <h3 className="mb-2 text-center font-serif text-base text-ink dark:text-dark-text">退出登录</h3>
                  <p className="mb-4 text-center text-sm leading-6 text-ink-500 dark:text-dark-text/60">退出后本机缓存将清空；你的收藏、笔记等已保存在云端，重新登录即可恢复。确定退出吗？</p>
                  <button onClick={doLogout} className="w-full rounded-2xl bg-rouge py-3 text-sm text-snow active:scale-[0.99]">退出登录</button>
                  <button onClick={close} className="mt-2 w-full rounded-2xl py-3 text-sm text-ink-500 dark:text-dark-text/60">取消</button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-1 text-xs text-ink-300">{title}</p>
      <div className="overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">{children}</div>
    </div>
  );
}
function Item({ label, value, danger, onClick }: { label: string; value?: string; danger?: boolean; onClick?: () => void }) {
  const base = "flex w-full items-center gap-3 border-b border-line px-4 py-3.5 last:border-0 dark:border-white/5";
  const inner = (
    <>
      <span className={"shrink-0 text-left text-sm " + (danger ? "text-rouge" : "text-ink dark:text-dark-text")}>{label}</span>
      {value && <span className="ml-auto max-w-[55%] truncate text-xs text-ink-300">{value}</span>}
      {onClick && <ChevronRight size={16} className={"text-ink-300 " + (value ? "" : "ml-auto")} />}
    </>
  );
  // 纯展示行（如版本号）：不可点就不渲染按钮、不给按压态，避免“看着能点却没反应”
  if (!onClick) return <div className={base}>{inner}</div>;
  return (
    <button onClick={onClick} className={base + " active:bg-moon/60 dark:active:bg-dark-bg"}>
      {inner}
    </button>
  );
}
function SegRow({ label, value, options, onPick }: { label: string; value: string | number; options: { v: string | number; t: string }[]; onPick: (v: string | number) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0 dark:border-white/5">
      <span className="text-sm text-ink dark:text-dark-text">{label}</span>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button key={String(o.v)} onClick={() => onPick(o.v)} className={"rounded-lg px-2.5 py-1 text-xs " + (value === o.v ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg dark:text-dark-text/60")}>{o.t}</button>
        ))}
      </div>
    </div>
  );
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs text-ink-500 dark:text-dark-text/60">{label}</label>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-line bg-moon px-3 py-2.5 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-bg dark:text-dark-text" />
    </div>
  );
}
