"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Camera, Check, ImagePlus } from "lucide-react";
import { useGoBack } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { Avatar } from "@/components/ui/Avatar";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useUI } from "@/lib/store";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { supabase } from "@/lib/supabase/client";

const PRESET_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

// 头像入库前先压一道：最长边 ≤512、JPEG 85%（手机原图动辄几 MB，传原图又慢又费存储）
async function compressImage(file: File, max = 512): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => no(new Error("图片解码失败"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // 先铺白底：透明 PNG 直接转 JPEG 会把透明区域染成纯黑
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("图片压缩失败"))), "image/jpeg", 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProfileEdit() {
  const goBack = useGoBack("/me"); // 直链打开无历史可退时兜底回「我的」
  const user = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  const toast = useUI((s) => s.toast);
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [seed, setSeed] = useState(user?.avatarSeed ?? 7);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(user?.avatarUrl);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  useLockBodyScroll(picker); // 头像选择弹层打开时锁定背景滚动
  const fileRef = useRef<HTMLInputElement>(null);
  const bioRef = useRef<HTMLTextAreaElement>(null);
  const pendingBlob = useRef<Blob | null>(null); // 已选但未保存的头像（点保存才真上传，取消不留垃圾文件）

  // 冷加载回填：直刷本页时 user 可能尚未从云端加载完成，state 以空初始化定格——
  // 待 user 就绪后回填一次（仅一次，不打扰用户后续编辑），否则点保存会把云端昵称/简介/头像洗掉（Review P1）
  const inited = useRef(false);
  useEffect(() => {
    if (user && !inited.current) {
      inited.current = true;
      setNickname(user.nickname ?? "");
      setBio(user.bio ?? "");
      setSeed(user.avatarSeed ?? 7);
      setAvatarUrl(user.avatarUrl);
    }
  }, [user]);

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

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("请选择图片文件", "error"); return; }
    try {
      const blob = await compressImage(f);
      pendingBlob.current = blob;
      // 本地预览用 dataURL（压缩后很小）；真上传发生在「保存」
      const reader = new FileReader();
      reader.onload = () => { setAvatarUrl(reader.result as string); setPicker(false); toast("头像已选好，记得保存"); };
      reader.onerror = () => toast("读取图片失败", "error");
      reader.readAsDataURL(blob);
    } catch {
      toast("图片处理失败，请换一张试试", "error");
    }
  }

  // T4.3 真保存：新头像传 Supabase Storage（avatars/<uid>/，策略限本人），拿公网 URL 写 profiles.avatar_url；
  // 选预设头像 = 显式清除云端头像（avatarUrl 传 undefined → DB 置 null）
  async function save() {
    if (!nickname.trim()) { toast("昵称不能为空", "error"); return; }
    if (!dirty) { goBack(); return; }
    if (saving) return;
    if (!user) { toast("登录已失效，请重新登录", "error"); return; } // 弹层在 RequireAuth 外，会话中途失效时不能静默没反应
    setSaving(true);
    try {
      let finalUrl = avatarUrl;
      if (pendingBlob.current) {
        const path = `${user.id}/avatar.jpg`;
        const { error } = await supabase.storage.from("avatars").upload(path, pendingBlob.current, { upsert: true, contentType: "image/jpeg" });
        if (error) { toast("头像上传失败，请检查网络后重试", "error"); return; }
        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        finalUrl = `${data.publicUrl}?v=${Date.now()}`; // 固定路径覆盖上传，加版本参数破 CDN 缓存
        pendingBlob.current = null;
        setAvatarUrl(finalUrl); // 公网 URL 固化进 state：写库失败重试时不会把 dataURL 预览当真值写库
      }
      const res = await updateProfile({ nickname: nickname.trim(), bio: bio.trim(), avatarSeed: seed, avatarUrl: finalUrl });
      if (res?.error) { toast("保存失败，请检查网络后重试", "error"); return; } // 不假装成功，留在本页可重试
      toast("已保存");
      goBack();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="relative min-h-[100dvh] pb-28">
      <header className="sticky top-0 z-30 flex h-14 items-center bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={goBack} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
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
              {/* 原生 maxLength 对 IME 友好：onChange 里 slice 回写会在拼音组合越过上限时强行打断组词 */}
              <input value={nickname} maxLength={16} onChange={(e) => setNickname(e.target.value)} aria-label="昵称" className="w-full bg-transparent text-right text-sm text-ink outline-none dark:text-dark-text" />
            </Row>
            <div className="border-b border-line px-4 py-3.5 dark:border-white/5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm text-ink-500 dark:text-dark-text/60">简介</span>
                <span className="text-[11px] text-ink-300">{bio.length}/30</span>
              </div>
              <textarea ref={bioRef} value={bio} maxLength={30} onChange={(e) => setBio(e.target.value)} rows={1} placeholder="一句话介绍自己" aria-label="简介" className="w-full resize-none overflow-hidden bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text" />
            </div>
            <Row label="账号">
              <span className="text-sm text-ink-300">{user?.account ?? user?.email}</span>
            </Row>
          </div>

          <button onClick={save} disabled={saving} className="mt-6 w-full rounded-2xl bg-celadon py-3.5 text-sm font-medium text-snow shadow-celadon disabled:opacity-60 active:scale-[0.99]">
            {saving ? "保存中" : "保存"}
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
                    <button key={sd} onClick={() => { setSeed(sd); setAvatarUrl(undefined); pendingBlob.current = null; setPicker(false); }} className="relative flex items-center justify-center">
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
