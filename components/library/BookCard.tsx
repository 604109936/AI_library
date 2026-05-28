"use client";
import Link from "next/link";
import type { Book } from "@/lib/types";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { formatCount } from "@/lib/utils";

/** 列表行卡片（分类列表/搜索） */
export function BookRow({ book, progress }: { book: Book; progress?: number }) {
  return (
    <Link
      href={`/library/book/${book.id}`}
      className="flex gap-3 rounded-lg bg-snow p-3 shadow-sm active:scale-[0.99] transition dark:bg-dark-card"
    >
      <BookCover title={book.title} seed={book.coverSeed} className="w-[64px] shrink-0" showText={false} />
      <div className="min-w-0 flex-1">
        <h3 className="font-serif text-base text-ink dark:text-dark-text">{book.title}</h3>
        <p className="mt-0.5 text-xs text-ink-500">{book.author}</p>
        <div className="mt-1 flex items-center gap-2">
          <Stars value={book.rating} size={12} />
          <span className="text-[11px] text-ink-300">{book.rating.toFixed(1)}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">{book.summary}</p>
        {typeof progress === "number" && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-celadon" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] text-ink-300">{progress}%</span>
          </div>
        )}
      </div>
    </Link>
  );
}

/** 网格卡片（收藏/推荐） */
export function BookGridCard({ book, sub }: { book: Book; sub?: string }) {
  return (
    <Link href={`/library/book/${book.id}`} className="block active:scale-[0.98] transition">
      <BookCover title={book.title} author={book.author} seed={book.coverSeed} className="w-full" />
      <h3 className="mt-2 truncate font-serif text-sm text-ink dark:text-dark-text">{book.title}</h3>
      <p className="truncate text-xs text-ink-300">{sub ?? book.author}</p>
    </Link>
  );
}

export function BookReadersText({ book }: { book: Book }) {
  return <span>{formatCount(book.readers)}人在读</span>;
}
