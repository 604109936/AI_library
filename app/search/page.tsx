"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Search as SearchIcon, X, BookMarked, Flame } from "lucide-react";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { search, hotSearches } from "@/lib/api";
import { useUI } from "@/lib/store";

export default function SearchPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const recent = useUI((s) => s.recentSearches);
  const addRecent = useUI((s) => s.addRecent);
  const clearRecent = useUI((s) => s.clearRecent);
  const removeRecent = useUI((s) => s.removeRecent);
  // 水合完成前不渲染历史，避免本地存储恢复时的闪烁
  const hydrated = useUI((s) => s.hydrated);

  // 防抖
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["search", q],
    queryFn: () => search(q),
    enabled: q.length > 0,
  });

  const hasResult = data && (data.books.length > 0 || data.chapters.length > 0);

  // 仅在「用户明确动作」（回车提交 / 点热门词 / 点历史词）时写入历史，
  // 不再随防抖键入自动写入，避免半截前缀词污染「最近搜过」
  function submit(term: string) {
    setInput(term);
    setQ(term.trim()); // 跳过防抖，立即进入结果态
    addRecent(term);
  }

  return (
    <main className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={() => router.back()} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
        </button>
        <form onSubmit={(e) => { e.preventDefault(); submit(input); }} className="flex flex-1 items-center gap-2 rounded-full border border-line bg-snow px-3.5 py-2 dark:border-white/10 dark:bg-dark-card">
          <SearchIcon size={16} className="text-ink-300" />
          <input
            autoFocus
            type="search"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜索书名 / 作者 / 标签"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text"
          />
          {input && (
            <button
              type="button"
              aria-label="清除"
              onClick={() => setInput("")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full active:bg-line/50 dark:active:bg-white/10"
            >
              <X size={16} className="text-ink-300" />
            </button>
          )}
        </form>
        <button onClick={() => router.back()} className="px-2 text-sm text-ink-500 dark:text-dark-text/60">取消</button>
      </header>

      <div className="p-4">
        {!q ? (
          <div className="space-y-6">
            {hydrated && recent.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm text-ink dark:text-dark-text">最近搜过</h2>
                  <button onClick={clearRecent} className="text-xs text-ink-300">清空</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((t) => (
                    <span key={t} className="flex items-center rounded-full bg-snow pl-3 pr-1 py-1 text-xs text-ink-700 dark:bg-dark-card dark:text-dark-text">
                      <button onClick={() => submit(t)} className="py-0.5 active:opacity-60">{t}</button>
                      <button
                        aria-label="移除"
                        onClick={() => removeRecent(t)}
                        className="ml-1 flex h-6 w-6 items-center justify-center rounded-full active:bg-line/50 dark:active:bg-white/10"
                      >
                        <X size={14} className="text-ink-300" />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h2 className="mb-2 flex items-center gap-1 text-sm text-ink dark:text-dark-text"><Flame size={14} className="text-rouge" /> 热门搜索</h2>
              <div className="flex flex-wrap gap-2">
                {hotSearches.map((t) => (
                  <button key={t} onClick={() => submit(t)} className="rounded-full bg-celadon-soft px-3 py-1.5 text-xs text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300">
                    {t}
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : isError ? (
          // 错误态优先于「查无结果」，避免把网络失败伪装成搜索无果
          <ErrorState onRetry={() => refetch()} />
        ) : !hasResult ? (
          <EmptyState icon="search" title="没有找到相关内容" subtitle="换个关键词试试" />
        ) : data ? (
          // 此分支 data 已被 TS 收窄为非空，无需非空断言（!）
          <div className="space-y-6">
            {data.books.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm text-ink dark:text-dark-text">书籍</h2>
                <div className="space-y-3">
                  {data.books.map((b) => <BookRow key={b.id} book={b} />)}
                </div>
              </section>
            )}
            {data.chapters.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm text-ink dark:text-dark-text">章节</h2>
                <div className="overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">
                  {data.chapters.map(({ book, chapter }) => (
                    <Link
                      key={chapter.id}
                      href={`/library/book/${book.id}/read?ch=${chapter.id}`}
                      className="flex items-center gap-2.5 border-b border-line px-4 py-3 last:border-0 dark:border-white/5"
                    >
                      <BookMarked size={15} className="shrink-0 text-celadon" />
                      <span className="flex-1 truncate text-sm text-ink-700 dark:text-dark-text/85">第{chapter.no}章 {chapter.title}</span>
                      <span className="shrink-0 text-xs text-ink-300">{book.title}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
