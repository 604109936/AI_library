"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { getBook } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { StarPicker } from "@/components/ui/Stars";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useLibrary, useUI } from "@/lib/store";

const MAX = 2000;

export default function ReviewEditor({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const openLogin = useUI((s) => s.openLogin);
  const toast = useUI((s) => s.toast);
  const addReview = useLibrary((s) => s.addReview);
  const { data: book } = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });

  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const canPublish = rating > 0 && content.trim().length >= 10;
  const hint = rating === 0 ? "请先打分" : content.trim().length < 10 ? `还需 ${10 - content.trim().length} 字即可发布` : "";

  // 实际发布：登录态用 store getState 实时读取，避免闭包捕获登录前的 null（登录后由 pending 回调触发也能拿到最新用户）
  function doPublish() {
    const u = useAuth.getState().user;
    if (!u || !book || !canPublish) return;
    addReview({
      id: "mr" + Date.now(),
      bookId: book.id.split("__")[0],
      bookTitle: book.title,
      bookCoverSeed: book.coverSeed,
      bookCover: book.cover,
      userId: "me",
      nickname: u.nickname,
      avatarSeed: u.avatarSeed,
      avatarUrl: u.avatarUrl,
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
  function publish() {
    if (!useAuth.getState().user) {
      openLogin(doPublish); // 未登录：登录成功后由 pending 回调执行 doPublish
      return;
    }
    doPublish();
  }

  const nearLimit = content.length > MAX * 0.9;

  return (
    <main className="relative min-h-[100dvh]">
      <Motif name="mountain" className="pointer-events-none absolute right-0 top-12 h-16 w-40 text-celadon/25" />
      <header className="sticky top-0 z-30 flex h-14 items-center bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={() => router.back()} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
        </button>
        <h1 className="flex-1 text-center font-serif text-lg text-ink dark:text-dark-text">写书评</h1>
        <button
          onClick={publish}
          disabled={!canPublish}
          className="rounded-full bg-celadon px-4 py-1.5 text-sm text-snow disabled:opacity-40"
        >
          发布
        </button>
      </header>

      <div className="relative space-y-5 p-4">
        {book && (
          <div className="flex items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm dark:bg-dark-card">
            <BookCover title={book.title} seed={book.coverSeed} src={book.cover} className="w-12" showText={false} />
            <span className="font-serif text-base text-ink dark:text-dark-text">{book.title}</span>
          </div>
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
            placeholder="写下你的想法…（支持简单 Markdown，至少 10 字）"
            className="h-44 w-full resize-none bg-transparent text-sm text-ink outline-none dark:text-dark-text"
          />
          <div className={"text-right text-[11px] " + (nearLimit ? "text-rouge" : "text-ink-300")}>{content.length}/{MAX}</div>
        </div>
      </div>
    </main>
  );
}
