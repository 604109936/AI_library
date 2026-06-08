"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Book } from "@/lib/types";
import { BookCover } from "@/components/ui/BookCover";
import { formatCount } from "@/lib/utils";

/** 列表行卡片（分类列表/搜索/推荐）。本期：书籍评分、在读人数不在 UI 展示（数据库仍存储） */
export function BookRow({ book, progress, statusLabel }: { book: Book; progress?: number; statusLabel?: "已读" | "未读" }) {
  return (
    <Link
      href={`/library/book/${book.id}`}
      className="flex items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm transition active:scale-[0.99] dark:bg-dark-card"
    >
      <BookCover title={book.title} seed={book.coverSeed} src={book.cover} className="w-[60px] shrink-0" showText={false} />
      <div className="min-w-0 flex-1">
        <h3 className="font-serif text-base text-ink dark:text-dark-text">{book.title}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500 dark:text-dark-text/55">{book.summary}</p>
        {typeof progress === "number" ? (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-line dark:bg-white/10">
              <div className="h-full rounded-full bg-celadon" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] text-ink-300">{progress}%</span>
          </div>
        ) : statusLabel ? (
          <div className="mt-1.5">
            <span
              className={
                "inline-block rounded-md px-1.5 py-0.5 text-[10px] font-medium " +
                (statusLabel === "已读"
                  ? "bg-celadon-soft text-celadon dark:bg-celadon/20 dark:text-celadon-300"
                  : "bg-moon text-ink-300 ring-1 ring-line dark:bg-dark-bg dark:text-dark-text/40 dark:ring-white/10")
              }
            >
              {statusLabel}
            </span>
          </div>
        ) : null}
      </div>
      <ChevronRight size={16} className="shrink-0 self-center text-ink-300" />
    </Link>
  );
}

/** 网格卡片（收藏/推荐） */
export function BookGridCard({ book, sub }: { book: Book; sub?: string }) {
  return (
    <Link href={`/library/book/${book.id}`} className="block transition active:scale-[0.98]">
      <BookCover title={book.title} author={book.author} seed={book.coverSeed} src={book.cover} className="w-full" />
      <h3 className="mt-2 truncate font-serif text-sm text-ink dark:text-dark-text">{book.title}</h3>
      <p className="truncate text-xs text-ink-300">{sub ?? book.author}</p>
    </Link>
  );
}

export function BookReadersText({ book }: { book: Book }) {
  return <span>{formatCount(book.readers)}人在读</span>;
}
