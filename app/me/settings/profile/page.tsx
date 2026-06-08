"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Camera, Check, ImagePlus } from "lucide-react";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useUI } from "@/lib/store";

const PRESET_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

export default function ProfileEdit() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  const toast = useUI((s) => s.toast);
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [seed, setSeed] = useState(user?.avatarSeed ?? 7);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(user?.avatarUrl);
  const [picker, setPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bioRef = useRef<HTMLTextAreaElement>(null);

  // 简介输入框高度随内容自适应
  useEffect(() => {
    const t = bioRef.current;
    if (t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  }, [bio]);

  const dirty =
    nickname !== (user?.nickname ?? "") ||
    bio !== (user?.bio ?? "") ||
    seed !== (user?.avatarSeed ?? 7) ||
    avatarUrl !== user?.avatarUrl;

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("请选择图片文件", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(reader.result as string);
      setPicker(false);
      toast("头像已更新，记得保存");
    };
    reader.onerror = () => toast("读取图片失败", "error");
    reader.readAsDataURL(f);
  }

  function save() {
    if (!nickname.trim()) { toast("昵称不能为空", "error"); return; }
    if (!dirty) { router.back(); return; }
    updateProfile({ nickname: nickname.trim(), bio: bio.trim(), avatarSeed: seed, avatarUrl });
    toast("已保存");
    router.back();
  }

  return (
    <main className="relative min-h-[100dvh] pb-28">
      <header className="sticky top-0 z-30 flex h-14 items-center bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={() => router.back()} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
        </button>
        <h1 className="flex-1 text-center font-serif text-lg text-ink dark:text-dark-text">编辑资料</h1>
        <div className="w-10" />
      </header>

      <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />

      <RequireAuth>
        <div className="p-4">
          <div className="flex flex-col items-center py-4">
            <button onClick={() => setPicker(true)} aria-label="更换头像" className="relative">
              <Avatar seed={seed} name={nickname} src={avatarUrl} size={84} ring />
              <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-celadon text-snow ring-2 ring-moon dark:ring-dark-bg">
                <Camera size={14} />
              </span>
            </button>
            <p className="mt-2 text-xs text-ink-300">点击更换头像</p>
          </div>

          <div className="overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">
            <Row label="昵称">
              <input value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 16))} aria-label="昵称" className="w-full bg-transparent text-right text-sm text-ink outline-none dark:text-dark-text" />
            </Row>
            <div className="border-b border-line px-4 py-3.5 dark:border-white/5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm text-ink-500 dark:text-dark-text/60">简介</span>
                <span className="text-[11px] text-ink-300">{bio.length}/30</span>
              </div>
              <textarea ref={bioRef} value={bio} onChange={(e) => setBio(e.target.value.slice(0, 30))} rows={1} placeholder="一句话介绍自己" aria-label="简介" className="w-full resize-none overflow-hidden bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text" />
            </div>
            <Row label="账号">
              <span className="text-sm text-ink-300">{user?.account ?? user?.email}</span>
            </Row>
          </div>

          <button onClick={save} className="mt-6 w-full rounded-2xl bg-celadon py-3.5 text-sm font-medium text-snow shadow-celadon active:scale-[0.99]">
            保存
          </button>
        </div>
      </RequireAuth>

      <Motif name="mountain" className="pointer-events-none absolute bottom-2 left-1/2 h-14 w-56 -translate-x-1/2 text-celadon/20" />

      <AnimatePresence>
        {picker && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setPicker(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 pb-[calc(env(safe-area-inset-bottom)+24px)] dark:bg-dark-card">
              <h3 className="mb-4 text-center font-serif text-base text-ink dark:text-dark-text">选择头像</h3>
              <button
                onClick={() => fileRef.current?.click()}
                className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-celadon py-3 text-sm text-celadon-700 active:scale-[0.99] dark:border-celadon/60 dark:text-celadon-300"
              >
                <ImagePlus size={16} /> 从相册 / 拍照上传
              </button>
              <p className="mb-2 px-1 text-xs text-ink-300">或选择预设头像</p>
              <div className="grid grid-cols-4 gap-4">
                {PRESET_SEEDS.map((sd) => {
                  const active = sd === seed && !avatarUrl;
                  return (
                    <button key={sd} onClick={() => { setSeed(sd); setAvatarUrl(undefined); setPicker(false); }} className="relative flex items-center justify-center">
                      <Avatar seed={sd} size={56} ring={active} />
                      {active && <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-celadon text-snow"><Check size={12} /></span>}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
