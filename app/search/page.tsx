"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Search as SearchIcon, X } from "lucide-react";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, EmptyState } from "@/components/ui/States";
import { search, hotSearches } from "@/lib/api";

export default function SearchPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>(["终身成长", "心理学", "卡罗尔"]);

  // 防抖
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isLoading } = useQuery({
    queryKey: ["search", q],
    queryFn: () => search(q),
    enabled: q.length > 0,
  });

  function submit(term: string) {
    setInput(term);
    setRecent((r) => [term, ...r.filter((x) => x !== term)].slice(0, 10));
  }

  const hasResult = data && (data.books.length > 0 || data.chapters.length > 0);

  return (
    <main className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} />
        </button>
        <div className="flex flex-1 items-center gap-2 rounded-full border border-line bg-snow px-3.5 py-2 dark:bg-dark-card">
          <SearchIcon size={16} className="text-ink-300" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜索书名 / 作者 / 标签"
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-300"
          />
          {input && <button onClick={() => setInput("")}><X size={16} className="text-ink-300" /></button>}
        </div>
        <button onClick={() => router.back()} className="px-2 text-sm text-ink-500">取消</button>
      </header>

      <div className="p-4">
        {!q ? (
          <div className="space-y-6">
            {recent.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm text-ink dark:text-dark-text">最近搜过</h2>
                  <button onClick={() => setRecent([])} className="text-xs text-ink-300">清空</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded-full bg-snow px-3 py-1.5 text-xs text-ink-700 dark:bg-dark-card dark:text-dark-text">
                      <button onClick={() => submit(t)}>{t}</button>
                      <button onClick={() => setRecent((r) => r.filter((x) => x !== t))}>
                        <X size={12} className="text-ink-300" />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h2 className="mb-2 text-sm text-ink dark:text-dark-text">热门搜索</h2>
              <div className="flex flex-wrap gap-2">
                {hotSearches.map((t) => (
                  <button key={t} onClick={() => submit(t)} className="rounded-full bg-celadon-soft px-3 py-1.5 text-xs text-celadon-700">
                    {t}
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        ) : !hasResult ? (
          <EmptyState title="没有找到相关内容" subtitle="换个关键词试试" />
        ) : (
          <div className="space-y-6">
            {data!.books.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm text-ink dark:text-dark-text">书籍</h2>
                <div className="space-y-3">
                  {data!.books.map((b) => <BookRow key={b.id} book={b} />)}
                </div>
              </section>
            )}
            {data!.chapters.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm text-ink dark:text-dark-text">章节</h2>
                <div className="overflow-hidden rounded-xl bg-snow shadow-sm dark:bg-dark-card">
                  {data!.chapters.map(({ book, chapter }) => (
                    <Link
                      key={chapter.id}
                      href={`/library/book/${book.id}/read?ch=${chapter.id}`}
                      className="flex items-center justify-between border-b border-line px-4 py-3 last:border-0"
                    >
                      <span className="text-sm text-ink-700 dark:text-dark-text">第{chapter.no}章 {chapter.title}</span>
                      <span className="text-xs text-ink-300">{book.title}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
