"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Type, List, Check, Trash2 } from "lucide-react";
import { getBook, getChapters } from "@/lib/api";
import { Skeleton } from "@/components/ui/States";
import { Motif } from "@/components/ui/Motif";
import { useLibrary, useReader, useUI, requireLogin, type ReaderBg } from "@/lib/store";
import type { Book, Chapter, NoteItem } from "@/lib/types";
import { HIGHLIGHTS, HIGHLIGHT_COLORS } from "@/lib/palette";
import { realId, genId, goBack } from "@/lib/utils";

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
  const progress = useLibrary((s) => s.progress);
  const setProgress = useLibrary((s) => s.setProgress);
  const pushHistory = useLibrary((s) => s.pushHistory);

  const bid = realId(id); // 真实书 id（去掉乱翻/无限滚动注入的 __ 后缀）

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });
  const chapters = chQ.data ?? [];
  // 首屏续读：URL 无 ?ch= 时，用已存进度的章节回填（lazy 初始化只取一次快照）
  const [curId, setCurId] = useState<string | null>(() => sp.get("ch") ?? progress[bid]?.chapterId ?? null);
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
  const rafRef = useRef<number | null>(null);
  const restoredRef = useRef(false); // 续读恢复只做一次，避免与上报互相覆盖
  const tocWarnedRef = useRef(false); // 非法章节 toast 只弹一次

  const bgCls = BG_OPTIONS.find((b) => b.key === reader.bg)?.cls ?? "reader-bg-moon";
  // 浮层主题跟随阅读底色（仅「深灰」档用深色面板），不再依赖全局 .dark，避免两套体系打架
  const panelDark = reader.bg === "dark";

  // 本章高亮笔记：用稳定值做 useMemo，避免每帧（滚动 setPct）重建数组导致高亮缓存失效
  const chapterNotes = useMemo(
    () => (cur ? notes.filter((n) => n.bookId === bid && n.chapterId === cur.id) : []),
    [notes, cur?.id, bid]
  );
  // 高亮渲染结果缓存：仅当正文/本章笔记变化时重算，滚动不再触发整段重排
  const highlighted = useMemo(
    () => (cur ? renderHighlighted(cur.content, chapterNotes, setActiveNote) : null),
    [cur?.id, cur?.content, chapterNotes]
  );

  // 历史 + 进度上报：进入即记录，之后每 5 秒一次，离开/切章再记录
  useEffect(() => {
    if (!bookQ.data || !cur) return;
    const b = bookQ.data;
    const report = () => {
      const prog = Math.max(1, Math.round(pctRef.current));
      pushHistory({ bookId: realId(b.id), bookTitle: b.title, author: b.author, coverSeed: b.coverSeed, cover: b.cover, mode: "text", progress: prog, lastAt: new Date().toISOString() });
      setProgress({ bookId: realId(b.id), chapterId: cur.id, chapterNo: cur.no, pct: prog, mode: "text" });
    };
    report();
    const t = setInterval(report, 5000);
    return () => { report(); clearInterval(t); };
    // eslint-disable-next-line
  }, [cur?.id, bookQ.data?.id]);

  // 首屏续读：仅当当前章正是「上次那一章」时，双 rAF 等正文(含高亮)布局完成后恢复滚动位置；只做一次
  useEffect(() => {
    if (restoredRef.current || !cur) return;
    const s = progress[bid];
    if (!s || s.chapterId !== cur.id) return; // 切到别章不恢复
    restoredRef.current = true; // 立即上锁，避免重复与上报互相干扰
    const pctSaved = Math.min(100, Math.max(0, s.pct));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el && pctSaved > 1) el.scrollTop = ((el.scrollHeight - el.clientHeight) * pctSaved) / 100;
      })
    );
    // eslint-disable-next-line
  }, [cur?.id, chQ.data]);

  // 非法 ch 参数：章节已加载且 URL 的 ch 无法命中任何章时，提示一次（不改第 41 行的兜底逻辑）
  useEffect(() => {
    const ch = sp.get("ch");
    if (!tocWarnedRef.current && ch && chapters.length > 0 && !chapters.some((c) => c.id === ch)) {
      tocWarnedRef.current = true;
      toast("未找到该章节，已为你打开第一章");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters.length]);

  // 卸载时清掉未执行的滚动节流帧
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    if (menu) setMenu(null); // 滚动即收起划词菜单，避免 fixed 坐标失效残留
    const p = (el.scrollTop / (el.scrollHeight - el.clientHeight || 1)) * 100;
    const clamped = Math.min(100, Math.max(0, p));
    pctRef.current = clamped; // 即时更新，供 5 秒上报用
    if (rafRef.current != null) return; // 已排程则跳过，rAF 节流 setPct
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPct(pctRef.current);
    });
  }

  function readSelection() {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !contentRef.current) { setMenu(null); return; }
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range) { setMenu(null); return; }
    const rect = range.getBoundingClientRect();
    const below = rect.top < 90; // 靠近顶栏时翻到选区下方
    setMenu({ x: rect.left + rect.width / 2, y: below ? rect.bottom + 8 : rect.top - 8, text, below });
  }
  // 移动端 touchend 后选区可能尚未稳定，稍延迟读取
  const onSelect = () => setTimeout(readSelection, 30);

  function doHighlight(color: string) {
    const text = menu?.text ?? "";
    requireLogin(() => {
      if (!bookQ.data || !cur) return;
      addNote(makeNote(bookQ.data, cur, text, "", color));
      toast("已高亮");
    });
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  }
  function openNote() {
    if (!menu) return;
    setNotePanel({ excerpt: menu.text, color: HIGHLIGHT_COLORS[0] });
    setNoteText("");
    setMenu(null);
  }
  function saveNote() {
    if (!notePanel) return;
    requireLogin(() => {
      if (!bookQ.data || !cur) return;
      addNote(makeNote(bookQ.data, cur, notePanel.excerpt, noteText, notePanel.color));
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
        <button onClick={() => goBack(router, `/library/book/${id}`)} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
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
        className="h-[calc(100dvh-3.5rem-3.5rem)] overflow-y-auto overscroll-contain px-6 pb-10 no-scrollbar"
        style={{ filter: `brightness(${reader.brightness})` }}
      >
        <div
          ref={contentRef}
          onMouseUp={onSelect}
          onTouchEnd={onSelect}
          className="mx-auto max-w-[680px] whitespace-pre-wrap font-serif leading-[1.9]"
          style={{ fontSize: reader.fontSize }}
        >
          {highlighted}
        </div>
        <div className="mx-auto mt-8 flex max-w-[680px] justify-between">
          <button disabled={idx <= 0} onClick={() => { setCurId(chapters[idx - 1].id); scrollRef.current?.scrollTo(0, 0); }} className="rounded-full border border-current/20 px-4 py-1.5 text-xs disabled:opacity-30">上一章</button>
          <button disabled={idx >= chapters.length - 1} onClick={() => { setCurId(chapters[idx + 1].id); scrollRef.current?.scrollTo(0, 0); }} className="rounded-full border border-current/20 px-4 py-1.5 text-xs disabled:opacity-30">下一章</button>
        </div>
      </div>

      {/* 底部工具栏：合并字号/背景/亮度为单一「设置」入口，避免四个入口指向同一面板 */}
      <div className="sticky bottom-0 z-20 border-t border-current/10 px-4 py-2 backdrop-blur">
        <div className="mb-1 text-center text-caption opacity-50">
          第{cur.no}/{chapters.length}章 · 本章 {Math.round(pct)}% · 全书 {Math.round(((idx + pct / 100) / chapters.length) * 100)}%
        </div>
        <div className="flex items-center justify-center gap-16">
          <ToolBtn icon={<List size={18} />} label="目录" onClick={() => setToc(true)} />
          <ToolBtn icon={<Type size={18} />} label="设置" onClick={() => setSettings(true)} />
        </div>
      </div>

      {/* 划线菜单（浅色磨砂胶囊 + 四色圆点；进出动效 + 滚动即关） */}
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.12 }}
            className={"fixed z-50 -translate-x-1/2 " + (menu.below ? "" : "-translate-y-full")}
            style={{ left: clampLeft(menu.x), top: menu.y }}
          >
            <div className={"rounded-2xl px-2 py-2 shadow-lg ring-1 backdrop-blur " + (panelDark ? "bg-dark-card/95 text-dark-text ring-white/10" : "bg-snow/95 text-ink ring-line")}>
              <div className="flex items-center gap-0.5 px-1 text-xs">
                <button className="px-2 py-0.5" onClick={() => doHighlight(HIGHLIGHT_COLORS[0])}>高亮</button>
                <span className={"h-3.5 w-px " + (panelDark ? "bg-white/10" : "bg-line")} />
                <button className="px-2 py-0.5" onClick={openNote}>笔记</button>
                <span className={"h-3.5 w-px " + (panelDark ? "bg-white/10" : "bg-line")} />
                <button className="px-2 py-0.5" onClick={() => { navigator.clipboard?.writeText(menu.text); toast("已复制"); setMenu(null); }}>复制</button>
              </div>
              <div className="mt-1.5 flex items-center justify-center gap-3">
                {HIGHLIGHT_COLORS.map((c, i) => (
                  <button key={c} onClick={() => doHighlight(c)} aria-label={`高亮·${HIGHLIGHTS[i].name}`} className="h-6 w-6 rounded-full ring-1 ring-black/5" style={{ background: c }} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 笔记输入浮层（含选色） */}
      <AnimatePresence>
        {notePanel && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setNotePanel(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className={"app-width relative rounded-t-2xl p-5 " + (panelDark ? "bg-dark-card" : "bg-snow")}>
              <p className={"mb-2 rounded-lg border-l-[3px] px-3 py-2 text-xs " + (panelDark ? "text-dark-text/75" : "text-ink-700")} style={{ borderColor: notePanel.color, background: notePanel.color + "22" }}>{notePanel.excerpt}</p>
              <div className="mb-2 flex items-center gap-3">
                <span className={"text-xs " + (panelDark ? "text-dark-text/60" : "text-ink-500")}>标记色</span>
                {HIGHLIGHT_COLORS.map((c, i) => (
                  <button key={c} onClick={() => setNotePanel((p) => (p ? { ...p, color: c } : p))} aria-label={`标记色·${HIGHLIGHTS[i].name}`} aria-pressed={notePanel.color === c} className={"h-5 w-5 rounded-full ring-2 " + (notePanel.color === c ? "ring-ink/40" : "ring-transparent")} style={{ background: c }} />
                ))}
              </div>
              <textarea autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="写下你的笔记…" className={"h-24 w-full resize-none rounded-lg border p-3 text-sm outline-none focus:border-celadon " + (panelDark ? "border-white/10 bg-dark-bg text-dark-text" : "border-line bg-moon text-ink")} />
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
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className={"app-width relative rounded-t-2xl p-5 " + (panelDark ? "bg-dark-card" : "bg-snow")}>
              <p className={"mb-2 rounded-lg border-l-[3px] px-3 py-2 text-sm " + (panelDark ? "text-dark-text/75" : "text-ink-700")} style={{ borderColor: activeNote.color, background: activeNote.color + "22" }}>{activeNote.excerpt}</p>
              {activeNote.note ? (
                <p className={"text-sm " + (panelDark ? "text-dark-text" : "text-ink")}>{activeNote.note}</p>
              ) : (
                <p className={"text-sm " + (panelDark ? "text-dark-text/55" : "text-ink-500")}>（仅高亮，无笔记）</p>
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
            <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }} className={"relative h-full w-[80%] max-w-[360px] overflow-y-auto overscroll-contain p-4 " + (panelDark ? "bg-dark-card" : "bg-snow")}>
              <h2 className={"font-serif text-lg " + (panelDark ? "text-dark-text" : "text-ink")}>目录</h2>
              <p className={"mt-0.5 text-xs " + (panelDark ? "text-dark-text/55" : "text-ink-500")}>{bookQ.data.title} · 共 {chapters.length} 章</p>
              <div className="mt-3 space-y-1">
                {chapters.map((c) => {
                  const on = c.id === cur.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setCurId(c.id); setToc(false); scrollRef.current?.scrollTo(0, 0); }}
                      className={"flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left " + (on ? (panelDark ? "bg-celadon/15" : "bg-celadon-soft") : "")}
                    >
                      <span className={"text-sm " + (on ? "font-medium text-celadon" : panelDark ? "text-dark-text/85" : "text-ink-700")}>第{c.no}章 {c.title}</span>
                      {on ? <span className="h-1.5 w-1.5 rounded-full bg-celadon" /> : c.status === "read" ? <Check size={14} className={panelDark ? "text-dark-text/55" : "text-ink-500"} /> : null}
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
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className={"app-width relative rounded-t-2xl p-5 " + (panelDark ? "bg-dark-card" : "bg-snow")}>
              <h3 className={"mb-3 text-center font-serif text-base " + (panelDark ? "text-dark-text" : "text-ink")}>阅读设置</h3>
              <Row label="字号" panelDark={panelDark}>
                <div className="flex gap-2">
                  {FONT_STEPS.map((f, i) => (
                    <button key={f} onClick={() => reader.setFontSize(f)} className={"rounded-lg px-3 py-1 text-sm " + (reader.fontSize === f ? "bg-celadon text-snow" : panelDark ? "bg-dark-bg text-dark-text/70" : "bg-moon text-ink-500")}>{FONT_LABEL[i]}</button>
                  ))}
                </div>
              </Row>
              <Row label="背景" panelDark={panelDark}>
                <div className="flex gap-3">
                  {BG_OPTIONS.map((b) => (
                    <button key={b.key} onClick={() => reader.setBg(b.key)} className="flex flex-col items-center gap-1" aria-label={"背景" + b.label}>
                      <span className={"h-8 w-8 rounded-full shadow-inner " + (reader.bg === b.key ? "ring-2 ring-celadon ring-offset-2 " + (panelDark ? "ring-offset-dark-card" : "ring-offset-snow") : "ring-1 ring-line")} style={{ background: b.swatch }} />
                      <span className={"text-micro " + (panelDark ? "text-dark-text/60" : "text-ink-500")}>{b.label}</span>
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="亮度" panelDark={panelDark}>
                <input type="range" min={0.5} max={1} step={0.02} value={reader.brightness} aria-label="亮度" aria-valuetext={`${Math.round(reader.brightness * 100)}%`} onChange={(e) => reader.setBrightness(+e.target.value)} className="w-44 accent-celadon" />
              </Row>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

/** 构造一条笔记/高亮（由调用方传入已确认非空的 book/cur，避免非空断言绕过空检查） */
function makeNote(book: Book, ch: Chapter, excerpt: string, note: string, color: string): NoteItem {
  return {
    id: genId("n"),
    bookId: realId(book.id),
    bookTitle: book.title,
    bookCoverSeed: book.coverSeed,
    chapterId: ch.id,
    chapterTitle: `第${ch.no}章 ${ch.title}`,
    excerpt, note, color,
    createdAt: new Date().toISOString(),
  };
}

/** 划词菜单水平夹取：以「手机壳宽」为参照（桌面壳约 480，移动端为真实视口），避免飘出内容区 */
function clampLeft(x: number): number {
  const w = typeof window !== "undefined" ? Math.min(window.innerWidth, 480) : 360;
  return Math.min(Math.max(x, 96), w - 96);
}

/**
 * 把正文中命中已存笔记摘录的片段包裹为可点击高亮。
 * - 重复文本：从上一条命中位置往后串行 indexOf，并校验切片相等，尽量落到正确那一处；
 * - 重叠高亮：不再「丢弃」，而是把所有标记边界切成区间分段，每段取覆盖它的最上层笔记（后插入者在上），
 *   保证「先标整句、再对其中词加笔记」时内层词标记不会凭空消失。
 */
function renderHighlighted(text: string, notes: NoteItem[], onClick: (n: NoteItem) => void) {
  const marks: { start: number; end: number; note: NoteItem; order: number }[] = [];
  let searchFrom = 0;
  notes.forEach((n, order) => {
    if (!n.excerpt) return;
    // 先从上一条之后找；找不到再从头找一次，兼顾「重复词按顺序铺开」与「乱序笔记仍能命中」
    let i = text.indexOf(n.excerpt, searchFrom);
    if (i < 0) i = text.indexOf(n.excerpt);
    if (i >= 0 && text.slice(i, i + n.excerpt.length) === n.excerpt) {
      marks.push({ start: i, end: i + n.excerpt.length, note: n, order });
      searchFrom = i + n.excerpt.length;
    }
  });
  if (!marks.length) return text;

  // 收集所有边界点，切成不重叠的区间分段
  const points = new Set<number>([0, text.length]);
  marks.forEach((m) => { points.add(m.start); points.add(m.end); });
  const sorted = Array.from(points).sort((a, b) => a - b);

  const out: React.ReactNode[] = [];
  for (let s = 0; s < sorted.length - 1; s++) {
    const segStart = sorted[s];
    const segEnd = sorted[s + 1];
    if (segEnd <= segStart) continue;
    // 覆盖本段的所有标记里，取最后插入（order 最大）的那条作为最上层
    let top: (typeof marks)[number] | null = null;
    for (const m of marks) {
      if (m.start <= segStart && m.end >= segEnd && (!top || m.order > top.order)) top = m;
    }
    const slice = text.slice(segStart, segEnd);
    if (!top) {
      out.push(slice);
    } else {
      const note = top.note;
      out.push(
        <mark
          key={segStart}
          onClick={() => onClick(note)}
          className="cursor-pointer rounded-sm px-0.5"
          style={{ background: note.color + "59", color: "inherit", textDecoration: note.note ? "underline dotted" : undefined, textUnderlineOffset: 3 }}
        >
          {slice}
        </mark>
      );
    }
  }
  return out;
}

function ToolBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} className="flex flex-col items-center gap-0.5 opacity-80">
      {icon}
      <span className="text-micro">{label}</span>
    </button>
  );
}
function Row({ label, panelDark, children }: { label: string; panelDark: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className={"text-sm " + (panelDark ? "text-dark-text/60" : "text-ink-500")}>{label}</span>
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
