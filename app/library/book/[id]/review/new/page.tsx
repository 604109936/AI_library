"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { getBook } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { StarPicker } from "@/components/ui/Stars";
import { useAuth, useLibrary, useUI } from "@/lib/store";

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

  useEffect(() => {
    if (!user) {
      openLogin(() => {});
    }
  }, [user, openLogin]);

  const canPublish = rating > 0 && content.trim().length >= 10;

  function publish() {
    if (!canPublish || !book) return;
    addReview({
      id: "mr" + Date.now(),
      bookId: book.id.split("__")[0],
      bookTitle: book.title,
      bookCoverSeed: book.coverSeed,
      userId: "me",
      nickname: user?.nickname ?? "书友·淮安",
      avatarSeed: user?.avatarSeed ?? 7,
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

  return (
    <main className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 flex h-14 items-center bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} />
        </button>
        <h1 className="flex-1 text-center font-serif text-lg">写书评</h1>
        <button
          onClick={publish}
          disabled={!canPublish}
          className="rounded-full bg-celadon px-4 py-1.5 text-sm text-snow disabled:opacity-40"
        >
          发布
        </button>
      </header>

      <div className="space-y-5 p-4">
        {book && (
          <div className="flex items-center gap-3 rounded-lg bg-snow p-3 shadow-sm dark:bg-dark-card">
            <BookCover title={book.title} seed={book.coverSeed} className="w-12" showText={false} />
            <span className="font-serif text-base text-ink dark:text-dark-text">{book.title}</span>
          </div>
        )}

        <div className="flex justify-center py-2">
          <StarPicker value={rating} onChange={setRating} />
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 30))}
          placeholder="给你的书评起个标题（选填）"
          className="w-full rounded-lg border border-line bg-snow px-3.5 py-3 text-sm outline-none focus:border-celadon dark:bg-dark-card"
        />

        <div className="rounded-lg border border-line bg-snow p-3 focus-within:border-celadon dark:bg-dark-card">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, 5000))}
            placeholder="写下你的想法…（支持简单 Markdown，至少 10 字）"
            className="h-44 w-full resize-none bg-transparent text-sm outline-none"
          />
          <div className="text-right text-[11px] text-ink-300">{content.length}/5000</div>
        </div>
      </div>
    </main>
  );
}
