"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth, useUI } from "@/lib/store";
import { Mail, Lock, Eye, EyeOff, BookHeart, User } from "lucide-react";

// 体验账号（真实 Supabase 用户，由 scripts/create-demo-user.mjs 建）
const DEMO_EMAIL = "demo@ailibrary.app";
const DEMO_PWD = "123456";

// Supabase 英文报错 → 中文
function zhError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "邮箱或密码不正确";
  if (m.includes("already registered") || m.includes("already exists")) return "该邮箱已注册，请直接登录";
  if (m.includes("password should be at least")) return "密码至少 6 位";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "邮箱格式不正确";
  if (m.includes("email not confirmed")) return "邮箱未验证，请先到邮箱点确认链接";
  if (m.includes("rate limit") || m.includes("too many")) return "操作太频繁，请稍后再试";
  return "出错了：" + msg;
}

export function LoginSheet() {
  const open = useUI((s) => s.loginOpen);
  const pending = useUI((s) => s.pending);
  const close = useUI((s) => s.closeLogin);
  const toast = useUI((s) => s.toast);
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const pwdOk = pwd.length >= 6;
  const canSubmit = emailOk && pwdOk && (mode === "login" || (pwd === pwd2 && nickname.trim().length > 0)) && !loading;

  function reset() {
    setEmail("");
    setNickname("");
    setPwd("");
    setPwd2("");
    setErr("");
    setLoading(false);
    setShow(false);
  }

  async function submit() {
    if (!canSubmit) return;
    setLoading(true);
    setErr("");
    const res = mode === "login" ? await login(email, pwd) : await register(email, pwd, nickname);
    if (res.error) {
      setErr(zhError(res.error));
      setLoading(false);
      return;
    }
    if ("needConfirm" in res && res.needConfirm) {
      setErr("注册成功，请到邮箱点确认链接后再登录");
      setLoading(false);
      return;
    }
    setLoading(false);
    toast(mode === "login" ? "欢迎回来" : "注册成功，已自动登录");
    const action = pending;
    close();
    reset();
    action?.(); // 立即执行挂起操作（已登录）
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={() => {
              close();
              reset();
            }}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="app-width relative rounded-t-[24px] bg-snow px-6 pb-8 pt-3 dark:bg-dark-card"
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line" />
            <div className="mb-4 flex flex-col items-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-celadon-soft">
                <BookHeart className="text-celadon" size={24} />
              </div>
              <h2 className="font-serif text-xl text-ink dark:text-dark-text">
                {mode === "login" ? "登录 / 注册" : "注册新账号"}
              </h2>
              <button
                type="button"
                onClick={() => { setMode("login"); setEmail(DEMO_EMAIL); setPwd(DEMO_PWD); setNickname(""); setErr(""); }}
                className="mt-2 rounded-full bg-celadon-soft px-3 py-1 text-xs text-celadon-700"
              >
                体验账号（点此一键填入，再点登录）
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
              <Field icon={<Mail size={16} />}>
                <input
                  className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text"
                  placeholder="邮箱"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {mode === "register" && (
                <Field icon={<User size={16} />}>
                  <input
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text"
                    placeholder="昵称"
                    type="text"
                    maxLength={16}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                </Field>
              )}
              <Field icon={<Lock size={16} />}>
                <input
                  className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text"
                  placeholder="密码（至少 6 位）"
                  type={show ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                />
                <button type="button" aria-label={show ? "隐藏密码" : "显示密码"} onClick={() => setShow((s) => !s)} className="text-ink-300">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </Field>
              {mode === "register" && (
                <Field icon={<Lock size={16} />}>
                  <input
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text"
                    placeholder="确认密码"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    value={pwd2}
                    onChange={(e) => setPwd2(e.target.value)}
                  />
                </Field>
              )}
              {err && <p className="text-xs text-rouge">{err}</p>}

              <button
                type="submit"
                disabled={!canSubmit}
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

              <div className="my-1 flex items-center justify-center">
                <span className="h-px w-full bg-gradient-to-r from-transparent via-brass/40 to-transparent" />
              </div>

              <div className="text-center">
                <button
                  type="button"
                  className="text-xs text-ink-300"
                  onClick={() => { close(); reset(); }}
                >
                  先逛逛
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-moon px-3.5 py-3 focus-within:border-celadon dark:bg-dark-bg">
      <span className="text-ink-300">{icon}</span>
      {children}
    </div>
  );
}
