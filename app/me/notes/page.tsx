"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronDown, Trash2, Pencil } from "lucide-react";
import { Header } from "@/components/shell/Header";
import { RequireAuth } from "@/components/shell/RequireAuth";
import { BookCover } from "@/components/ui/BookCover";
import { EmptyState } from "@/components/ui/States";
import { useLibrary, useUI } from "@/lib/store";
import { formatDate } from "@/lib/utils";
import type { NoteItem } from "@/lib/types";

export default function NotesPage() {
  const router = useRouter();
  const notes = useLibrary((s) => s.notes);
  const removeNote = useLibrary((s) => s.removeNote);
  const updateNote = useLibrary((s) => s.updateNote);
  const toast = useUI((s) => s.toast);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

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

  const openId = expanded ?? groups[0]?.[0];

  function startEdit(n: NoteItem) {
    setEditingId(n.id);
    setEditText(n.note);
  }
  function saveEdit(id: string) {
    updateNote(id, editText.trim());
    setEditingId(null);
    toast("笔记已更新");
  }

  return (
    <main className="min-h-[100dvh]">
      <Header title="我的笔记" />
      <RequireAuth>
        <div className="px-4">
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-snow px-3.5 py-2.5 dark:border-white/10 dark:bg-dark-card">
            <Search size={16} className="text-ink-300" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setExpanded(null); }} aria-label="搜索笔记或书名" placeholder="搜索笔记或书名" className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text" />
          </div>

          {groups.length === 0 ? (
            <EmptyState icon="note" title={q ? "没有找到相关笔记" : "还没有笔记"} subtitle={q ? "换个关键词试试" : "去读一本书，划线写笔记吧"} actionText={q ? undefined : "去泡馆逛逛"} actionHref="/library" />
          ) : (
            <div className="mt-3 space-y-3">
              {groups.map(([bookId, items]) => {
                const isOpen = openId === bookId;
                // 书名/封面用笔记快照（创建时存的 bookTitle/bookCoverSeed）
                const title = items[0].bookTitle;
                return (
                  <div key={bookId} className="overflow-hidden rounded-2xl bg-snow shadow-sm dark:bg-dark-card">
                    <button onClick={() => setExpanded(isOpen ? "__none__" : bookId)} className="flex w-full items-center gap-3 p-3">
                      <BookCover title={title} seed={items[0].bookCoverSeed} className="w-10" showText={false} />
                      <span className="flex-1 text-left font-serif text-sm text-ink dark:text-dark-text">
                        {title} · {items.length} 条笔记
                      </span>
                      <ChevronDown size={16} className={"text-ink-300 transition " + (isOpen ? "rotate-180" : "")} />
                    </button>
                    {isOpen && (
                      <div className="space-y-3 border-t border-line p-3 dark:border-white/5">
                        {items.map((n) => {
                          const editing = editingId === n.id;
                          return (
                            <div
                              key={n.id}
                              onClick={() => { if (!editing) router.push(`/library/book/${n.bookId}/read?ch=${n.chapterId}&mark=${n.id}`); }}
                              className={"rounded-xl bg-moon p-3 transition dark:bg-dark-bg " + (editing ? "" : "cursor-pointer active:bg-celadon-soft/60 dark:active:bg-white/5")}
                            >
                              {/* 笔记源（原文摘录）不可修改 */}
                              <p className="border-l-[3px] pl-2.5 text-xs leading-5 text-ink-700 dark:text-dark-text/85" style={{ borderColor: n.color }}>
                                {n.excerpt}
                              </p>
                              {editing ? (
                                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                                  <textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="写下你的笔记…" className="h-20 w-full resize-none rounded-lg border border-line bg-snow p-2 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text" />
                                  <div className="mt-2 flex justify-end gap-2">
                                    <button onClick={() => setEditingId(null)} className="rounded-full px-3 py-1 text-xs text-ink-500 dark:text-dark-text/60">取消</button>
                                    <button onClick={() => saveEdit(n.id)} className="rounded-full bg-celadon px-3 py-1 text-xs text-snow">保存</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {n.note && <p className="mt-2 text-sm text-ink dark:text-dark-text">{n.note}</p>}
                                  <div className="mt-2 flex items-center justify-between text-[11px] text-ink-300">
                                    <span className="truncate text-celadon-700 dark:text-celadon-300">{n.chapterTitle} ›</span>
                                    <div className="flex shrink-0 items-center gap-3">
                                      <span>{formatDate(n.createdAt)}</span>
                                      <button aria-label="编辑笔记" onClick={(e) => { e.stopPropagation(); startEdit(n); }} className="p-1 active:text-celadon-700">
                                        <Pencil size={13} />
                                      </button>
                                      <button aria-label="删除笔记" onClick={(e) => { e.stopPropagation(); removeNote(n.id); toast("已删除"); }} className="p-1 active:text-rouge">
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
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
