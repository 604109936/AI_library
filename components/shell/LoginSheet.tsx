"use client";
import { useState } from "react";
import { useAuth, useUI } from "@/lib/store";
import { Mail, Lock, Eye, EyeOff, BookHeart } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";

export function LoginSheet() {
  const open = useUI((s) => s.loginOpen);
  const pending = useUI((s) => s.pending);
  const close = useUI((s) => s.closeLogin);
  const toast = useUI((s) => s.toast);
  const login = useAuth((s) => s.login);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const emailOk = email.trim().length >= 3; // 邮箱或账号（体验账号 123456）
  const pwdOk = pwd.length >= 6;

  function reset() {
    setEmail("");
    setPwd("");
    setPwd2("");
    setErr("");
    setLoading(false);
    setShow(false);
  }

  function dismiss() {
    close();
    reset();
  }

  async function submit() {
    if (loading) return;
    // 具体校验提示，避免"点不动却不知为何"
    if (!emailOk) return setErr("请输入邮箱或账号（至少 3 位）");
    if (!pwdOk) return setErr("密码至少 6 位");
    if (mode === "register" && pwd !== pwd2) return setErr("两次输入的密码不一致");
    setLoading(true);
    setErr("");
    await new Promise((r) => setTimeout(r, 700));
    // mock：任意合法邮箱+密码即成功
    login(email);
    setLoading(false);
    toast(mode === "login" ? "欢迎回来" : "注册成功，已自动登录");
    const action = pending;
    close();
    reset();
    setTimeout(() => action?.(), 60);
  }

  return (
    <BottomSheet open={open} onClose={dismiss} label={mode === "login" ? "登录或注册" : "注册新账号"}>
      <div className="mb-4 flex flex-col items-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-celadon-soft">
          <BookHeart className="text-celadon" size={24} />
        </div>
        <h2 className="font-serif text-xl text-ink dark:text-dark-text">
          {mode === "login" ? "登录 / 注册" : "注册新账号"}
        </h2>
        <button
          type="button"
          onClick={() => { setMode("login"); setEmail("123456"); setPwd("123456"); setErr(""); }}
          className="mt-2 rounded-full bg-celadon-soft px-3 py-1 text-xs text-celadon-700"
        >
          体验账号 123456 / 123456（点此一键填入）
        </button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <Field icon={<Mail size={16} />}>
          <input
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-500 dark:text-dark-text dark:placeholder:text-dark-text/40"
            placeholder="邮箱 / 账号"
            type="text"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (err) setErr(""); }}
          />
        </Field>
        <Field icon={<Lock size={16} />}>
          <input
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-500 dark:text-dark-text dark:placeholder:text-dark-text/40"
            placeholder="密码"
            type={show ? "text" : "password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={pwd}
            onChange={(e) => { setPwd(e.target.value); if (err) setErr(""); }}
          />
          <button type="button" aria-label={show ? "隐藏密码" : "显示密码"} onClick={() => setShow((s) => !s)} className="text-ink-500">
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </Field>
        {pwd.length > 0 && !pwdOk && <p className="px-1 text-xs text-ink-500 dark:text-dark-text/55">密码至少 6 位</p>}
        {mode === "register" && (
          <>
            <Field icon={<Lock size={16} />}>
              <input
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-500 dark:text-dark-text dark:placeholder:text-dark-text/40"
                placeholder="确认密码"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={pwd2}
                onChange={(e) => { setPwd2(e.target.value); if (err) setErr(""); }}
              />
            </Field>
            {pwd2.length > 0 && pwd !== pwd2 && <p className="px-1 text-xs text-rouge">两次输入的密码不一致</p>}
          </>
        )}
        {err && <p className="px-1 text-xs text-rouge">{err}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-1 w-full rounded-2xl bg-ink py-3 text-sm font-medium text-snow transition active:scale-[0.98] disabled:opacity-40 dark:bg-celadon"
        >
          {loading ? "请稍候…" : mode === "login" ? "登录" : "注册"}
        </button>

        <div className="pt-1 text-center">
          <button
            type="button"
            className="text-xs text-rouge"
            onClick={() => { setMode((m) => (m === "login" ? "register" : "login")); setErr(""); }}
          >
            {mode === "login" ? "没有账号？立即注册" : "已有账号？返回登录"}
          </button>
        </div>

        {/* 渐隐装饰分隔线 */}
        <div className="my-1 flex items-center justify-center">
          <span className="h-px w-full bg-gradient-to-r from-transparent via-brass/40 to-transparent" />
        </div>

        <div className="text-center">
          <button type="button" className="text-xs text-ink-500 dark:text-dark-text/55" onClick={dismiss}>
            先逛逛
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-moon px-3.5 py-3 focus-within:border-celadon dark:border-white/10 dark:bg-dark-bg">
      <span className="text-ink-500 dark:text-dark-text/55">{icon}</span>
      {children}
    </div>
  );
}
