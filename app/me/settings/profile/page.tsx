"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Camera, Check } from "lucide-react";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Skeleton } from "@/components/ui/States";
import { useAuth, useUI } from "@/lib/store";
import { goBack } from "@/lib/utils";

const PRESET_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function ProfileEdit() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated); // 资料是否已从本地恢复，未恢复时用骨架占位防布局跳动（F59）
  const updateProfile = useAuth((s) => s.updateProfile);
  const toast = useUI((s) => s.toast);
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [seed, setSeed] = useState(user?.avatarSeed ?? 7);
  const [picker, setPicker] = useState(false);
  const [askLeave, setAskLeave] = useState(false); // 有未保存修改时的离开二次确认（F59）

  const dirty = nickname !== (user?.nickname ?? "") || bio !== (user?.bio ?? "") || seed !== (user?.avatarSeed ?? 7);

  // 返回：有未保存修改先弹确认，否则直接返回（带历史栈兜底，F38）
  function onBack() {
    if (dirty) { setAskLeave(true); return; }
    goBack(router, "/me/settings");
  }

  function save() {
    if (!nickname.trim()) { toast("昵称不能为空", "error"); return; }
    if (!dirty) { goBack(router, "/me/settings"); return; }
    updateProfile({ nickname: nickname.trim(), bio: bio.trim(), avatarSeed: seed });
    toast("已保存");
    router.replace("/me/settings"); // 保存后语义化跳回设置页，避免回退到不确定的历史项（F38）
  }

  return (
    <main className="relative min-h-[100dvh] pb-28">
      <header className="pt-safe sticky top-0 z-30 flex h-14 items-center bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={onBack} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
        </button>
        <h1 className="flex-1 text-center font-serif text-lg text-ink dark:text-dark-text">编辑资料</h1>
        <div className="w-10" />
      </header>

      <RequireAuth>
        <div className="p-4">
          {/* 头像 */}
          <div className="flex flex-col items-center py-4">
            <button onClick={() => setPicker(true)} aria-label="更换头像" className="relative">
              <Avatar seed={seed} name={nickname} size={84} ring />
              <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-celadon text-snow ring-2 ring-moon dark:ring-dark-bg">
                <Camera size={14} />
              </span>
            </button>
            <p className="mt-2 text-xs text-ink-500 dark:text-dark-text/55">点击更换头像</p>
          </div>

          {/* 资料未恢复（hydrated=false）时用等高骨架占位，避免输入卡到达后整体跳动（F59 防 CLS） */}
          {!hydrated ? (
            <Skeleton className="h-[168px] rounded-2xl" />
          ) : (
            <div className="overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">
              <Row label="昵称">
                <input value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 16))} aria-label="昵称" className="w-full bg-transparent text-right text-sm text-ink outline-none dark:text-dark-text" />
              </Row>
              <div className="border-b border-line px-4 py-3.5 dark:border-white/5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm text-ink-500 dark:text-dark-text/60">简介</span>
                  <span className="text-caption text-ink-500 dark:text-dark-text/55">{bio.length}/30</span>
                </div>
                <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 30))} rows={2} placeholder="一句话介绍自己" aria-label="简介" className="w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-500 dark:text-dark-text dark:placeholder:text-dark-text/45" />
              </div>
              <Row label="账号">
                <span className="text-sm text-ink-500 dark:text-dark-text/55">{user?.account ?? user?.email}</span>
              </Row>
            </div>
          )}

          {/* 底部大号保存按钮 */}
          <button onClick={save} className="mt-6 w-full rounded-2xl bg-celadon py-3.5 text-sm font-medium text-snow shadow-celadon active:scale-[0.99]">
            保存
          </button>
        </div>
      </RequireAuth>

      <Motif name="mountain" className="pointer-events-none absolute bottom-2 left-1/2 h-14 w-56 -translate-x-1/2 text-celadon/20" />

      {/* 预设头像选择（统一用 BottomSheet：遮罩/滚动锁定/ESC/焦点/底部安全区，F61 + 圆角 token，F92） */}
      <BottomSheet open={picker} onClose={() => setPicker(false)} label="选择头像">
        <h3 className="mb-4 text-center font-serif text-base text-ink dark:text-dark-text">选择头像</h3>
        <div className="grid grid-cols-4 gap-4">
          {PRESET_SEEDS.map((sd) => (
            <button key={sd} onClick={() => { setSeed(sd); setPicker(false); }} aria-label={`头像 ${sd}`} aria-pressed={sd === seed} className="relative flex items-center justify-center">
              <Avatar seed={sd} size={56} ring={sd === seed} />
              {sd === seed && <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-celadon text-snow"><Check size={12} /></span>}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* 未保存修改离开二次确认（F59） */}
      <BottomSheet open={askLeave} onClose={() => setAskLeave(false)} label="放弃本次修改确认">
        <p className="text-center text-sm text-ink dark:text-dark-text">放弃本次修改？</p>
        <p className="mt-1 text-center text-xs text-ink-500 dark:text-dark-text/55">未保存的昵称、简介与头像将不会保留</p>
        <div className="mt-4 flex gap-3">
          <button onClick={() => setAskLeave(false)} className="flex-1 rounded-2xl bg-moon py-3 text-sm text-ink-700 dark:bg-dark-bg dark:text-dark-text/80">继续编辑</button>
          <button onClick={() => { setAskLeave(false); goBack(router, "/me/settings"); }} className="flex-1 rounded-2xl bg-rouge py-3 text-sm text-snow">放弃</button>
        </div>
      </BottomSheet>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0 dark:border-white/5">
      <span className="w-14 shrink-0 text-sm text-ink-500 dark:text-dark-text/60">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
