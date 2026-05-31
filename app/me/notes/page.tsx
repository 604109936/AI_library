"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronDown, Trash2 } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { EmptyState } from "@/components/ui/States";
import { useLibrary, useUI } from "@/lib/store";
import { formatDate } from "@/lib/utils";
import { books } from "@/lib/mock/data";
import type { NoteItem } from "@/lib/types";

export default function NotesPage() {
  const notes = useLibrary((s) => s.notes);
  const removeNote = useLibrary((s) => s.removeNote);
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState("");
  // 三态展开：undefined=未操作(默认展开首组) / null=显式全收起 / string=指定书（F84，替代魔法串）
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);

  const groups = useMemo(() => {
    const kw = q.trim();
    const filtered = kw
      ? notes.filter((n) => n.note.includes(kw) || n.excerpt.includes(kw) || n.bookTitle.includes(kw))
      : notes;
    const map = new Map<string, NoteItem[]>();
    for (const n of filtered) {
      const arr = map.get(n.bookId) ?? [];
      arr.push(n);
      map.set(n.bookId, arr);
    }
    return Array.from(map.entries());
  }, [notes, q]);

  // 默认展开首个分组（搜索后随结果变化），而非硬编码 id；null 表示已显式全收起
  const cur = openId === undefined ? groups[0]?.[0] : openId;

  return (
    <main className="min-h-[100dvh]">
      <Header title="我的笔记" />
      <RequireAuth>
        <div className="px-4">
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-snow px-3.5 py-2.5 dark:border-white/10 dark:bg-dark-card">
            <Search size={16} className="text-ink-300" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索笔记或书名" placeholder="搜索笔记或书名" className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text" />
          </div>

          {groups.length === 0 ? (
            <EmptyState icon="note" title={q ? "没有找到相关笔记" : "还没有笔记"} subtitle={q ? "换个关键词试试" : "去读一本书，划线写笔记吧"} actionText={q ? undefined : "去泡馆逛逛"} actionHref="/library" />
          ) : (
            <div className="mt-3 space-y-3">
              {groups.map(([bookId, items]) => {
                const isOpen = cur === bookId;
                const cover = books.find((b) => b.id === bookId)?.cover;
                return (
                  <div key={bookId} className="overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">
                    <button onClick={() => setOpenId(isOpen ? null : bookId)} className="flex w-full items-center gap-3 p-3">
                      <BookCover title={items[0].bookTitle} seed={items[0].bookCoverSeed} src={cover} className="w-10" showText={false} />
                      <span className="flex-1 text-left font-serif text-sm text-ink dark:text-dark-text">
                        {items[0].bookTitle} · {items.length} 条笔记
                      </span>
                      <ChevronDown size={16} className={"text-ink-300 transition " + (isOpen ? "rotate-180" : "")} />
                    </button>
                    {isOpen && (
                      <div className="space-y-3 border-t border-line p-3 dark:border-white/5">
                        {items.map((n) => (
                          <div key={n.id} className="rounded-xl bg-moon p-3 dark:bg-dark-bg">
                            <p className="border-l-[3px] pl-2.5 text-xs leading-5 text-ink-700 dark:text-dark-text/85" style={{ borderColor: n.color }}>
                              {n.excerpt}
                            </p>
                            {n.note && <p className="mt-2 text-sm text-ink dark:text-dark-text">{n.note}</p>}
                            <div className="mt-2 flex items-center justify-between text-caption text-ink-500 dark:text-dark-text/55">
                              <Link href={`/library/book/${n.bookId}/read?ch=${n.chapterId}`} className="text-celadon-700 dark:text-celadon-300">
                                {n.chapterTitle}
                              </Link>
                              <div className="flex items-center gap-3">
                                <span>{formatDate(n.createdAt)}</span>
                                <button aria-label="删除笔记" onClick={() => { removeNote(n.id); toast("已删除"); }} className="p-1 active:text-rouge">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </RequireAuth>
    </main>
  );
}
