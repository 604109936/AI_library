"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { getBook } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { StarPicker } from "@/components/ui/Stars";
import { Motif } from "@/components/ui/Motif";
import { Skeleton } from "@/components/ui/States";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { genId, realId } from "@/lib/utils";
import { useAuth, useLibrary, useUI } from "@/lib/store";

const MAX = 5000; // 字数上限对齐需求「10-5000 字」

export default function ReviewEditor({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const openLogin = useUI((s) => s.openLogin);
  const toast = useUI((s) => s.toast);
  const addReview = useLibrary((s) => s.addReview);
  const { data: book } = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });

  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false); // 发布锁，防重复提交
  const [askLeave, setAskLeave] = useState(false); // 草稿未保存离开确认

  const canPublish = rating > 0 && content.trim().length >= 10;
  const hint = rating === 0 ? "请先打分" : content.trim().length < 10 ? `还需 ${10 - content.trim().length} 字即可发布` : "";
  // 是否有未保存的草稿（打了分 / 写了标题或正文）
  const dirty = rating > 0 || title.trim().length > 0 || content.trim().length > 0;

  function publish() {
    if (submitting) return; // 已在发布中，忽略重复点击
    if (!book) return;
    if (!user) {
      openLogin(publish); // 未登录强制登录后再发布
      return;
    }
    if (!canPublish) return;
    setSubmitting(true); // 通过校验、真正写入前再置锁，避免未登录场景把按钮永久锁死
    addReview({
      id: genId("mr"),
      bookId: realId(book.id),
      bookTitle: book.title,
      bookCoverSeed: book.coverSeed,
      bookCover: book.cover,
      userId: "me",
      nickname: user.nickname,
      avatarSeed: user.avatarSeed,
      avatarUrl: user.avatarUrl,
      rating,
      title: title.trim() || undefined,
      content: content.trim(),
      likes: 0,
      createdAt: new Date().toISOString(),
      mine: true,
    });
    toast("书评已发布");
    router.back();
  }

  // 返回拦截：有草稿先弹确认，避免静默丢弃
  function onBack() {
    if (dirty) setAskLeave(true);
    else router.back();
  }

  const nearLimit = content.length > MAX * 0.9;

  return (
    <main className="relative min-h-[100dvh]">
      <Motif name="mountain" className="pointer-events-none absolute right-0 top-12 h-16 w-40 text-celadon/25" />
      <header className="sticky top-0 z-30 flex h-14 items-center bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={onBack} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
        </button>
        <h1 className="flex-1 text-center font-serif text-lg text-ink dark:text-dark-text">写书评</h1>
        <button
          onClick={publish}
          disabled={!canPublish || submitting}
          className="rounded-full bg-celadon px-4 py-1.5 text-sm text-snow disabled:opacity-40"
        >
          {submitting ? "发布中…" : "发布"}
        </button>
      </header>

      <div className="relative space-y-5 p-4">
        {book ? (
          <div className="flex items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm dark:bg-dark-card">
            <BookCover title={book.title} seed={book.coverSeed} src={book.cover} className="w-12" showText={false} />
            <span className="font-serif text-base text-ink dark:text-dark-text">{book.title}</span>
          </div>
        ) : (
          // 书卡未加载完用等高骨架占位，避免到达后整体下移（CLS）
          <Skeleton className="h-[72px] rounded-2xl" />
        )}

        <div className="flex flex-col items-center gap-1.5 py-2">
          <StarPicker value={rating} onChange={setRating} />
          {hint && <span className="text-xs text-ink-300">{hint}</span>}
        </div>

        <div className="relative">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 30))}
            placeholder="给你的书评起个标题（选填）"
            className="w-full rounded-2xl border border-line bg-snow px-3.5 py-3 pr-14 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-300">{title.length}/30</span>
        </div>

        <div className="rounded-2xl border border-line bg-snow p-3 focus-within:border-celadon dark:border-white/10 dark:bg-dark-card">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, MAX))}
            placeholder="写下你的想法…（至少 10 字）"
            className="h-44 w-full resize-none bg-transparent text-sm text-ink outline-none dark:text-dark-text"
          />
          <div className={"text-right text-[11px] " + (nearLimit ? "text-rouge" : "text-ink-300")}>{content.length}/{MAX}</div>
        </div>
      </div>

      {/* 草稿未保存离开确认 */}
      <BottomSheet open={askLeave} onClose={() => setAskLeave(false)} label="放弃草稿确认">
        <p className="text-center text-sm text-ink dark:text-dark-text">放弃这篇草稿？</p>
        <p className="mt-1 text-center text-xs text-ink-500 dark:text-dark-text/60">离开后已写的内容不会保留</p>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => setAskLeave(false)}
            className="flex-1 rounded-2xl bg-moon py-3 text-sm text-ink-700 dark:bg-dark-bg dark:text-dark-text/80"
          >
            继续编辑
          </button>
          <button
            onClick={() => {
              setAskLeave(false);
              router.back();
            }}
            className="flex-1 rounded-2xl bg-rouge py-3 text-sm text-snow"
          >
            放弃
          </button>
        </div>
      </BottomSheet>
    </main>
  );
}
