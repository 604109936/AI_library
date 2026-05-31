"use client";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Book } from "@/lib/types";
import { BookCover } from "@/components/ui/BookCover";
import { Stars } from "@/components/ui/Stars";
import { formatCount } from "@/lib/utils";

/** 列表行卡片（分类列表/搜索/推荐） */
export function BookRow({ book, progress }: { book: Book; progress?: number }) {
  return (
    <Link
      href={`/library/book/${book.id}`}
      className="flex items-center gap-3 rounded-2xl bg-snow p-3 shadow-sm transition active:scale-[0.99] dark:bg-dark-card"
    >
      <BookCover title={book.title} seed={book.coverSeed} src={book.cover} className="w-[60px] shrink-0" showText={false} />
      <div className="min-w-0 flex-1">
        <h3 className="font-serif text-base text-ink dark:text-dark-text">{book.title}</h3>
        <p className="mt-0.5 text-xs text-ink-500 dark:text-dark-text/55">{book.author}</p>
        <div className="mt-1 flex items-center gap-2">
          <Stars value={book.rating} size={12} />
          <span className="text-caption text-ink-500 dark:text-dark-text/55">{book.rating.toFixed(1)}</span>
          <span className="text-caption text-ink-500 dark:text-dark-text/55">· {formatCount(book.readers)}人在读</span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500 dark:text-dark-text/55">{book.summary}</p>
        {typeof progress === "number" && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-line dark:bg-white/10">
              <div className="h-full rounded-full bg-celadon" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-micro text-ink-500 dark:text-dark-text/55">{progress}%</span>
          </div>
        )}
      </div>
      <ChevronRight size={16} className="shrink-0 self-center text-ink-300" />
    </Link>
  );
}
