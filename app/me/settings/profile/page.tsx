"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Camera, ChevronRight } from "lucide-react";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { Avatar } from "@/components/ui/Avatar";
import { useAuth, useUI } from "@/lib/store";

export default function ProfileEdit() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const updateProfile = useAuth((s) => s.updateProfile);
  const toast = useUI((s) => s.toast);
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");

  function save() {
    updateProfile({ nickname: nickname.trim() || "书友", bio: bio.trim() });
    toast("已保存");
    router.back();
  }

  return (
    <main className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 flex h-14 items-center bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} />
        </button>
        <h1 className="flex-1 text-center font-serif text-lg">编辑资料</h1>
        <button onClick={save} className="rounded-full bg-celadon px-4 py-1.5 text-sm text-snow">保存</button>
      </header>

      <RequireAuth>
        <div className="p-4">
          {/* 头像 */}
          <div className="flex flex-col items-center py-4">
            <button onClick={() => toast("更换头像功能即将上线", "info")} className="relative">
              <Avatar seed={user?.avatarSeed ?? 7} name={nickname} size={84} />
              <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-celadon text-snow ring-2 ring-moon dark:ring-dark-bg">
                <Camera size={14} />
              </span>
            </button>
            <p className="mt-2 text-xs text-ink-300">点击更换头像</p>
          </div>

          <div className="overflow-hidden rounded-xl bg-snow shadow-sm dark:bg-dark-card">
            <Row label="昵称">
              <input value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 16))} className="w-full bg-transparent text-right text-sm outline-none" />
            </Row>
            <Row label="简介">
              <input value={bio} onChange={(e) => setBio(e.target.value.slice(0, 30))} placeholder="一句话介绍自己" className="w-full bg-transparent text-right text-sm outline-none placeholder:text-ink-300" />
            </Row>
            <Row label="邮箱">
              <span className="text-sm text-ink-300">{user?.email}</span>
            </Row>
            <button onClick={() => toast("修改密码功能即将上线", "info")} className="flex w-full items-center px-4 py-3.5">
              <span className="flex-1 text-left text-sm text-ink dark:text-dark-text">修改密码</span>
              <ChevronRight size={16} className="text-ink-300" />
            </button>
          </div>
        </div>
      </RequireAuth>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
      <span className="w-14 shrink-0 text-sm text-ink-500">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
