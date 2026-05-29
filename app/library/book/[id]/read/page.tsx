"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Type, List, Palette, Sun, Check, Trash2 } from "lucide-react";
import { getBook, getChapters } from "@/lib/api";
import { Skeleton } from "@/components/ui/States";
import { Motif } from "@/components/ui/Motif";
import { useLibrary, useReader, useUI, requireLogin, type ReaderBg } from "@/lib/store";
import type { Chapter, NoteItem } from "@/lib/types";

const HL_COLORS = ["#8FB39B", "#D9C08A", "#D69A95", "#C9C6BE"]; // 青瓷/黄铜/胭脂/淡墨（新中式低饱和）
const BG_OPTIONS: { key: ReaderBg; label: string; cls: string; swatch: string }[] = [
  { key: "white", label: "白", cls: "reader-bg-white", swatch: "#FFFFFF" },
  { key: "moon", label: "米黄", cls: "reader-bg-moon", swatch: "#F4F2ED" },
  { key: "green", label: "护眼", cls: "reader-bg-green", swatch: "#E8F0E4" },
  { key: "dark", label: "深灰", cls: "reader-bg-dark", swatch: "#1F1E18" },
];
const FONT_STEPS = [16, 18, 20, 22];
const FONT_LABEL = ["小", "中", "大", "超大"];

function ReaderInner({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useUI((s) => s.toast);
  const reader = useReader();
  const addNote = useLibrary((s) => s.addNote);
  const removeNote = useLibrary((s) => s.removeNote);
  const notes = useLibrary((s) => s.notes);
  const setProgress = useLibrary((s) => s.setProgress);
  const pushHistory = useLibrary((s) => s.pushHistory);

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });
  const chapters = chQ.data ?? [];
  const [curId, setCurId] = useState<string | null>(null);
  const cur: Chapter | undefined = chapters.find((c) => c.id === (curId ?? sp.get("ch"))) ?? chapters[0];

  const [toc, setToc] = useState(false);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; text: string; below: boolean } | null>(null);
  const [notePanel, setNotePanel] = useState<{ excerpt: string; color: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [activeNote, setActiveNote] = useState<NoteItem | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const pctRef = useRef(0);

  const bgCls = BG_OPTIONS.find((b) => b.key === reader.bg)?.cls ?? "reader-bg-moon";
  const chapterNotes = cur ? notes.filter((n) => n.bookId === id.split("__")[0] && n.chapterId === cur.id) : [];

  // 历史 + 进度上报：进入即记录，之后每 5 秒一次，离开/切章再记录
  useEffect(() => {
    if (!bookQ.data || !cur) return;
    const b = bookQ.data;
    const report = () => {
      const prog = Math.max(1, Math.round(pctRef.current));
      pushHistory({ bookId: b.id.split("__")[0], bookTitle: b.title, author: b.author, coverSeed: b.coverSeed, cover: b.cover, mode: "text", progress: prog, lastAt: new Date().toISOString() });
      setProgress({ bookId: b.id.split("__")[0], chapterId: cur.id, chapterNo: cur.no, pct: prog, mode: "text" });
    };
    report();
    const t = setInterval(report, 5000);
    return () => { report(); clearInterval(t); };
    // eslint-disable-next-line
  }, [cur?.id, bookQ.data?.id]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const p = (el.scrollTop / (el.scrollHeight - el.clientHeight || 1)) * 100;
    const clamped = Math.min(100, Math.max(0, p));
    pctRef.current = clamped;
    setPct(clamped);
  }

  function readSelection() {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !contentRef.current) { setMenu(null); return; }
    try {
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      const below = rect.top < 90; // 靠近顶栏时翻到选区下方
      setMenu({ x: rect.left + rect.width / 2, y: below ? rect.bottom + 8 : rect.top - 8, text, below });
    } catch { setMenu(null); }
  }
  // 移动端 touchend 后选区可能尚未稳定，稍延迟读取
  const onSelect = () => setTimeout(readSelection, 30);

  function doHighlight(color: string) {
    const text = menu?.text ?? "";
    requireLogin(() => {
      addNote(makeNote(text, "", color));
      toast("已高亮");
    });
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  }
  function makeNote(excerpt: string, note: string, color: string): NoteItem {
    return {
      id: "n" + Date.now(),
      bookId: bookQ.data!.id.split("__")[0],
      bookTitle: bookQ.data!.title,
      bookCoverSeed: bookQ.data!.coverSeed,
      chapterId: cur!.id,
      chapterTitle: `第${cur!.no}章 ${cur!.title}`,
      excerpt, note, color,
      createdAt: new Date().toISOString(),
    };
  }
  function openNote() {
    if (!menu) return;
    setNotePanel({ excerpt: menu.text, color: HL_COLORS[0] });
    setNoteText("");
    setMenu(null);
  }
  function saveNote() {
    if (!notePanel) return;
    requireLogin(() => {
      addNote(makeNote(notePanel.excerpt, noteText, notePanel.color));
      toast("笔记已保存");
    });
    setNotePanel(null);
    window.getSelection()?.removeAllRanges();
  }

  if (bookQ.isLoading || chQ.isLoading)
    return (
      <main className="min-h-[100dvh] p-4">
        <Skeleton className="h-6 w-40 rounded" />
        <Skeleton className="mt-4 h-80 w-full rounded" />
      </main>
    );
  if (!bookQ.data || !cur) return <div className="p-8 text-center text-ink-500">未找到内容</div>;

  const idx = chapters.findIndex((c) => c.id === cur.id);

  return (
    <main className={"relative min-h-[100dvh] " + bgCls}>
      <Motif name="bamboo" className="reader-deco h-24 w-24" />
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 flex h-14 items-center px-2 backdrop-blur" style={{ background: "transparent" }}>
        <button onClick={() => router.back()} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} />
        </button>
        <h1 className="flex-1 truncate text-center font-serif text-base">第{cur.no}章 {cur.title}</h1>
        <button onClick={() => setSettings(true)} aria-label="阅读设置" className="flex h-10 w-10 items-center justify-center rounded-full">
          <Type size={20} />
        </button>
      </header>

      {/* 正文（亮度只作用于本容器，不影响浮层） */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-[calc(100dvh-3.5rem-3.5rem)] overflow-y-auto px-6 pb-10 no-scrollbar"
        style={{ filter: `brightness(${reader.brightness})` }}
      >
        <div
          ref={contentRef}
          onMouseUp={onSelect}
          onTouchEnd={onSelect}
          className="mx-auto max-w-[680px] whitespace-pre-wrap font-serif leading-[1.9]"
          style={{ fontSize: reader.fontSize }}
        >
          {renderHighlighted(cur.content, chapterNotes, setActiveNote)}
        </div>
        <div className="mx-auto mt-8 flex max-w-[680px] justify-between">
          <button disabled={idx <= 0} onClick={() => { setCurId(chapters[idx - 1].id); scrollRef.current?.scrollTo(0, 0); }} className="rounded-full border border-current/20 px-4 py-1.5 text-xs disabled:opacity-30">上一章</button>
          <button disabled={idx >= chapters.length - 1} onClick={() => { setCurId(chapters[idx + 1].id); scrollRef.current?.scrollTo(0, 0); }} className="rounded-full border border-current/20 px-4 py-1.5 text-xs disabled:opacity-30">下一章</button>
        </div>
      </div>

      {/* 底部工具栏 */}
      <div className="sticky bottom-0 z-20 border-t border-current/10 px-4 py-2 backdrop-blur">
        <div className="mb-1 text-center text-[11px] opacity-50">
          第{cur.no}/{chapters.length}章 · 本章 {Math.round(pct)}% · 全书 {Math.round(((idx + pct / 100) / chapters.length) * 100)}%
        </div>
        <div className="flex items-center justify-around">
          <ToolBtn icon={<List size={18} />} label="目录" onClick={() => setToc(true)} />
          <ToolBtn icon={<Type size={18} />} label="字号" onClick={() => setSettings(true)} />
          <ToolBtn icon={<Palette size={18} />} label="背景" onClick={() => setSettings(true)} />
          <ToolBtn icon={<Sun size={18} />} label="亮度" onClick={() => setSettings(true)} />
        </div>
      </div>

      {/* 划线菜单（浅色磨砂胶囊 + 四色圆点） */}
      {menu && (
        <div
          className={"fixed z-50 -translate-x-1/2 " + (menu.below ? "" : "-translate-y-full")}
          style={{ left: Math.min(Math.max(menu.x, 96), (typeof window !== "undefined" ? window.innerWidth : 360) - 96), top: menu.y }}
        >
          <div className="rounded-2xl bg-snow/95 px-2 py-2 text-ink shadow-lg ring-1 ring-line backdrop-blur dark:bg-dark-card/95 dark:text-dark-text dark:ring-white/10">
            <div className="flex items-center gap-0.5 px-1 text-xs">
              <button className="px-2 py-0.5" onClick={() => doHighlight(HL_COLORS[0])}>高亮</button>
              <span className="h-3.5 w-px bg-line dark:bg-white/10" />
              <button className="px-2 py-0.5" onClick={openNote}>笔记</button>
              <span className="h-3.5 w-px bg-line dark:bg-white/10" />
              <button className="px-2 py-0.5" onClick={() => { navigator.clipboard?.writeText(menu.text); toast("已复制"); setMenu(null); }}>复制</button>
            </div>
            <div className="mt-1.5 flex items-center justify-center gap-3">
              {HL_COLORS.map((c) => (
                <button key={c} onClick={() => doHighlight(c)} aria-label="高亮颜色" className="h-6 w-6 rounded-full ring-1 ring-black/5" style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 笔记输入浮层（含选色） */}
      <AnimatePresence>
        {notePanel && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setNotePanel(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 dark:bg-dark-card">
              <p className="mb-2 rounded-lg border-l-[3px] px-3 py-2 text-xs text-ink-700 dark:text-dark-text/75" style={{ borderColor: notePanel.color, background: notePanel.color + "22" }}>{notePanel.excerpt}</p>
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs text-ink-500 dark:text-dark-text/60">标记色</span>
                {HL_COLORS.map((c) => (
                  <button key={c} onClick={() => setNotePanel((p) => (p ? { ...p, color: c } : p))} className={"h-5 w-5 rounded-full ring-2 " + (notePanel.color === c ? "ring-ink/40" : "ring-transparent")} style={{ background: c }} aria-label="选择标记色" />
                ))}
              </div>
              <textarea autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="写下你的笔记…" className="h-24 w-full resize-none rounded-lg border border-line bg-moon p-3 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-bg dark:text-dark-text" />
              <button onClick={saveNote} className="mt-3 w-full rounded-2xl bg-celadon py-2.5 text-sm text-snow active:scale-[0.99]">保存</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 查看/删除已高亮笔记 */}
      <AnimatePresence>
        {activeNote && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setActiveNote(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 dark:bg-dark-card">
              <p className="mb-2 rounded-lg border-l-[3px] px-3 py-2 text-sm text-ink-700 dark:text-dark-text/75" style={{ borderColor: activeNote.color, background: activeNote.color + "22" }}>{activeNote.excerpt}</p>
              {activeNote.note ? (
                <p className="text-sm text-ink dark:text-dark-text">{activeNote.note}</p>
              ) : (
                <p className="text-sm text-ink-300">（仅高亮，无笔记）</p>
              )}
              <button
                onClick={() => { removeNote(activeNote.id); toast("已删除"); setActiveNote(null); }}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-rouge/40 py-2.5 text-sm text-rouge active:scale-[0.99]"
              >
                <Trash2 size={15} /> 删除这条标记
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 章节目录抽屉 */}
      <AnimatePresence>
        {toc && (
          <motion.div className="fixed inset-0 z-50 flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }} className="relative h-full w-[80%] max-w-[360px] overflow-y-auto bg-snow p-4 dark:bg-dark-card">
              <h2 className="font-serif text-lg text-ink dark:text-dark-text">目录</h2>
              <p className="mt-0.5 text-xs text-ink-300">{bookQ.data.title} · 共 {chapters.length} 章</p>
              <div className="mt-3 space-y-1">
                {chapters.map((c) => {
                  const on = c.id === cur.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setCurId(c.id); setToc(false); scrollRef.current?.scrollTo(0, 0); }}
                      className={"flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left " + (on ? "bg-celadon-soft dark:bg-celadon/15" : "")}
                    >
                      <span className={"text-sm " + (on ? "font-medium text-celadon" : "text-ink-700 dark:text-dark-text/85")}>第{c.no}章 {c.title}</span>
                      {on ? <span className="h-1.5 w-1.5 rounded-full bg-celadon" /> : c.status === "read" ? <Check size={14} className="text-ink-300" /> : null}
                    </button>
                  );
                })}
              </div>
              <Motif name="mountain" className="mt-6 h-16 w-full text-celadon/30" />
            </motion.div>
            <div className="flex-1 bg-ink/30" onClick={() => setToc(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 阅读设置面板 */}
      <AnimatePresence>
        {settings && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/20" onClick={() => setSettings(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 dark:bg-dark-card">
              <h3 className="mb-3 text-center font-serif text-base text-ink dark:text-dark-text">阅读设置</h3>
              <Row label="字号">
                <div className="flex gap-2">
                  {FONT_STEPS.map((f, i) => (
                    <button key={f} onClick={() => reader.setFontSize(f)} className={"rounded-lg px-3 py-1 text-sm " + (reader.fontSize === f ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg dark:text-dark-text/70")}>{FONT_LABEL[i]}</button>
                  ))}
                </div>
              </Row>
              <Row label="背景">
                <div className="flex gap-3">
                  {BG_OPTIONS.map((b) => (
                    <button key={b.key} onClick={() => reader.setBg(b.key)} className="flex flex-col items-center gap-1" aria-label={"背景" + b.label}>
                      <span className={"h-8 w-8 rounded-full shadow-inner " + (reader.bg === b.key ? "ring-2 ring-celadon ring-offset-2 ring-offset-snow dark:ring-offset-dark-card" : "ring-1 ring-line")} style={{ background: b.swatch }} />
                      <span className="text-[10px] text-ink-500 dark:text-dark-text/60">{b.label}</span>
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="亮度">
                <input type="range" min={0.5} max={1} step={0.02} value={reader.brightness} aria-label="亮度" onChange={(e) => reader.setBrightness(+e.target.value)} className="w-44 accent-celadon" />
              </Row>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

/** 把正文中命中已存笔记摘录的片段包裹为可点击高亮 */
function renderHighlighted(text: string, notes: NoteItem[], onClick: (n: NoteItem) => void) {
  const marks: { start: number; end: number; note: NoteItem }[] = [];
  notes.forEach((n) => {
    if (!n.excerpt) return;
    const i = text.indexOf(n.excerpt);
    if (i >= 0) marks.push({ start: i, end: i + n.excerpt.length, note: n });
  });
  if (!marks.length) return text;
  marks.sort((a, b) => a.start - b.start);
  const clean: typeof marks = [];
  let lastEnd = 0;
  for (const m of marks) if (m.start >= lastEnd) { clean.push(m); lastEnd = m.end; }
  const out: React.ReactNode[] = [];
  let pos = 0;
  clean.forEach((m, k) => {
    if (m.start > pos) out.push(text.slice(pos, m.start));
    out.push(
      <mark
        key={k}
        onClick={() => onClick(m.note)}
        className="cursor-pointer rounded-sm px-0.5"
        style={{ background: m.note.color + "59", color: "inherit", textDecoration: m.note.note ? "underline dotted" : undefined, textUnderlineOffset: 3 }}
      >
        {text.slice(m.start, m.end)}
      </mark>
    );
    pos = m.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function ToolBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex flex-col items-center gap-0.5 opacity-80">
      {icon}
      <span className="text-[10px]">{label}</span>
    </button>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-ink-500 dark:text-dark-text/60">{label}</span>
      {children}
    </div>
  );
}

export default function ReaderPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-500">加载中…</div>}>
      <ReaderInner id={params.id} />
    </Suspense>
  );
}
