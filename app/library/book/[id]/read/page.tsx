"use client";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, List, Check, Trash2, Settings2, StickyNote, PenLine, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly"; // 让 **加粗**/*斜体* 紧贴中文标点也能正确解析（CommonMark 默认对 CJK 不友好）
import { getBook, getChapters } from "@/lib/api";
import { Skeleton, ErrorState } from "@/components/ui/States";
import { Motif } from "@/components/ui/Motif";
import { useLibrary, useReader, useUI, requireLogin, type ReaderBg } from "@/lib/store";
import { useReadingClock } from "@/lib/useReadingClock";
import { uid, chapterLabel } from "@/lib/utils";
import type { Chapter, NoteItem } from "@/lib/types";

// useLayoutEffect 在 SSR 无意义，客户端才用（消除告警）
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
// 在正文中按「真实摘录 + 就近偏移」定位：扛真机 Range 微差，也能在重复文本里挑出正确的一处，标记始终完整
function locate(text: string, excerpt: string, hint: number): number {
  if (!excerpt) return -1;
  if (text.slice(hint, hint + excerpt.length) === excerpt) return hint;
  let best = -1, bestD = Infinity, from = 0;
  for (;;) {
    const i = text.indexOf(excerpt, from);
    if (i < 0) break;
    const d = Math.abs(i - hint);
    if (d < bestD) { bestD = d; best = i; }
    from = i + 1;
  }
  return best;
}

const HL_COLORS = ["#8FB39B", "#D9C08A", "#D69A95", "#C9C6BE"]; // 青瓷/黄铜/胭脂/淡墨
const BG_OPTIONS: { key: ReaderBg; label: string; cls: string; swatch: string }[] = [
  { key: "white", label: "白", cls: "reader-bg-white", swatch: "#FFFFFF" },
  { key: "moon", label: "米黄", cls: "reader-bg-moon", swatch: "#F3EAD6" },
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
  const markChapterRead = useLibrary((s) => s.markChapterRead);
  const readChapters = useLibrary((s) => s.readChapters);

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });
  const chapters = chQ.data ?? [];
  const [curId, setCurId] = useState<string | null>(null);
  const cur: Chapter | undefined = chapters.find((c) => c.id === (curId ?? sp.get("ch"))) ?? chapters[0];

  const [toc, setToc] = useState(false);
  const [settings, setSettings] = useState(false);
  const [notesPanel, setNotesPanel] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; text: string; below: boolean; start: number } | null>(null);
  const [menuX, setMenuX] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [notePanel, setNotePanel] = useState<{ excerpt: string; color: string; start: number } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [activeNote, setActiveNote] = useState<NoteItem | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const pctRef = useRef(0);
  const resumed = useRef(false);
  useReadingClock(!!cur); // 文字阅读时长计入「我的-总时长」

  const bgCls = BG_OPTIONS.find((b) => b.key === reader.bg)?.cls ?? "reader-bg-moon";
  const realId = id.split("__")[0];
  const readCh = readChapters[realId] ?? [];
  const chapterNotes = cur ? notes.filter((n) => n.bookId === realId && n.chapterId === cur.id) : [];

  // Markdown 渲染：按「章节内容」memo，使笔记/其它状态变化时不重渲染正文 DOM（我们对其做命令式高亮，才不会被 React 协调冲掉）
  const md = useMemo(
    () => <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]} components={mdComponents}>{cur?.content ?? ""}</ReactMarkdown>,
    [cur?.content]
  );
  // 渲染（含切章）后给正文打高亮；笔记增删时重标
  useIsoLayoutEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const ns = cur ? notes.filter((n) => n.bookId === realId && n.chapterId === cur.id) : [];
    applyHighlights(root, ns, setActiveNote);
  }, [cur?.id, cur?.content, notes, realId]);

  useEffect(() => {
    if (resumed.current || !chapters.length) return;
    resumed.current = true;
    if (curId || sp.get("ch")) return;
    const saved = useLibrary.getState().progress[id.split("__")[0]]?.chapterId;
    if (saved && chapters.some((c) => c.id === saved)) setCurId(saved);
  }, [chapters, curId, sp, id]);

  useEffect(() => {
    if (!bookQ.data || !cur) return;
    // 切章/进入：先回顶再重置本章进度，原子一致（旧章进度已由上一次 cleanup 写入，不受本次影响）
    scrollRef.current?.scrollTo(0, 0);
    pctRef.current = 0;
    setPct(0);
    const b = bookQ.data;
    const report = (allowMark: boolean) => {
      const rid = b.id.split("__")[0];
      const el = scrollRef.current;
      const max = el ? el.scrollHeight - el.clientHeight : 0;
      // 本章读毕：滚到底(≥95%) 或 内容不足一屏（无需滚动）。仅在渲染稳定后(非进入瞬间)判定，
      // 避免进入时布局未稳(max≈0)把长章节误判为读毕（提前打√）。
      if (allowMark && (pctRef.current >= 95 || max <= 4)) markChapterRead(rid, cur.id);
      const readNow = useLibrary.getState().readChapters[rid] ?? [];
      const N = chapters.length || 1;
      // 进度 =（已读完章节数 + 当前章滚动比例）/ 总章数：章内滚动也前进，全部读完才 100
      const doneN = Math.min(readNow.length, chapters.length);
      const curDone = readNow.includes(cur.id);
      const frac = curDone ? 0 : Math.max(0, Math.min(1, pctRef.current / 100));
      const prog = doneN >= chapters.length ? 100 : Math.min(99, Math.round(((doneN + frac) / N) * 100));
      pushHistory({ bookId: rid, bookTitle: b.title, author: b.author, coverSeed: b.coverSeed, cover: b.cover, mode: "text", progress: prog, lastAt: new Date().toISOString() });
      setProgress({ bookId: rid, chapterId: cur.id, chapterNo: cur.no, pct: prog, mode: "text" });
    };
    report(false); // 进入：只记进度，不判读毕
    const t = setInterval(() => report(true), 5000);
    return () => { report(true); clearInterval(t); };
    // eslint-disable-next-line
  }, [cur?.id, bookQ.data?.id]);

  // 从「我的笔记」跳转：轮询等高亮渲染好（应对数据水合/渲染延迟）再滚动到对应标记并轻闪一下
  useEffect(() => {
    const mk = sp.get("mark");
    if (!mk || !cur) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const el = document.getElementById("mk-" + mk);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "auto" }); // 直接定位，不做平滑滚动动画
        el.animate?.([{ filter: "brightness(1.45)" }, { filter: "brightness(1)" }], { duration: 1200, easing: "ease-out" });
        return;
      }
      if (++tries < 25) timer = setTimeout(tick, 150); // 最多约 3.75s 等渲染/水合
    };
    timer = setTimeout(tick, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line
  }, [cur?.id, sp]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const p = (el.scrollTop / (max || 1)) * 100;
    const clamped = Math.min(100, Math.max(0, p));
    pctRef.current = clamped;
    setPct(clamped);
    // 滚到底(≥95%) 或 内容不足一屏(无需滚动) 即记为本章读毕（与定时上报口径一致）
    if ((clamped >= 95 || max <= 4) && bookQ.data && cur) markChapterRead(realId, cur.id);
  }

  function readSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !contentRef.current || !cur) { setMenu(null); return; }
    // 选区必须落在正文内（排除笔记输入框等其它选区）
    if (!contentRef.current.contains(sel.anchorNode) || !contentRef.current.contains(sel.focusNode)) { setMenu(null); return; }
    const text = sel.toString().trim(); // 用户真实选中的文字 = excerpt 真值，保证标记完整
    if (!text) { setMenu(null); return; }
    try {
      const range = sel.getRangeAt(0);
      // 选区近似起点仅作定位「提示」，真正落位由 locate 就近精确匹配 text
      const pre = range.cloneRange();
      pre.selectNodeContents(contentRef.current);
      pre.setEnd(range.startContainer, range.startOffset);
      const raw = sel.toString();
      const hint = pre.toString().length + (raw.length - raw.trimStart().length);
      const start = locate(contentRef.current?.textContent ?? "", text, hint);
      const rect = range.getBoundingClientRect();
      const below = rect.top < 110;
      setMenu({ x: rect.left + rect.width / 2, y: below ? rect.bottom + 10 : rect.top - 10, text, below, start });
    } catch { setMenu(null); }
  }
  // 用 selectionchange 监听（防抖）：移动端「首次长按选词」也能触发（长按选择常发 pointercancel 而非 pointerup）
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onSel = () => { if (t) clearTimeout(t); t = setTimeout(readSelection, 130); };
    document.addEventListener("selectionchange", onSel);
    return () => { document.removeEventListener("selectionchange", onSel); if (t) clearTimeout(t); };
    // eslint-disable-next-line
  }, [cur?.id]);
  // 工具条按实测宽度夹取左右位置，避免贴最左/最右时被截断
  useIsoLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const half = menuRef.current.offsetWidth / 2;
    const vw = window.innerWidth;
    setMenuX(Math.min(Math.max(menu.x, 8 + half), vw - 8 - half));
  }, [menu]);

  function makeNote(excerpt: string, note: string, color: string, start?: number): NoteItem {
    return {
      id: uid(), // 安全上下文无关的 uuid（手机经 HTTP/LAN 也可用，与 DB notes.id 对齐）
      bookId: bookQ.data!.id.split("__")[0],
      bookTitle: bookQ.data!.title,
      bookCoverSeed: bookQ.data!.coverSeed,
      chapterId: cur!.id,
      chapterTitle: chapterLabel(cur!.no, cur!.title),
      excerpt, // 保存完整选中文本
      note,
      color,
      start,
      end: typeof start === "number" ? start + excerpt.length : undefined,
      createdAt: new Date().toISOString(),
    };
  }
  function doHighlight(color: string) {
    const text = menu?.text ?? "";
    const start = menu?.start;
    if (!text) { setMenu(null); return; }
    requireLogin(() => { addNote(makeNote(text, "", color, start)); toast("已高亮"); });
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  }
  function openNote() {
    if (!menu) return;
    const m = menu;
    // 与「高亮」一致：先校验登录，避免未登录写完笔记点保存才弹登录、输入被清空
    requireLogin(() => {
      setNotePanel({ excerpt: m.text, color: HL_COLORS[0], start: m.start });
      setNoteText("");
    });
    setMenu(null);
  }
  function copySelection() {
    const t = menu?.text ?? "";
    if (!t) { setMenu(null); return; }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(t).then(() => toast("已复制")).catch(() => toast("复制失败，请重试", "error"));
    } else {
      // 非安全上下文(HTTP/局域网 IP)无 Clipboard API → 回退 execCommand
      try {
        const ta = document.createElement("textarea");
        ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
        toast("已复制");
      } catch { toast("复制失败，请重试", "error"); }
    }
    setMenu(null);
    window.getSelection()?.removeAllRanges();
  }
  function saveNote() {
    if (!notePanel) return;
    requireLogin(() => { addNote(makeNote(notePanel.excerpt, noteText, notePanel.color, notePanel.start)); toast("笔记已保存"); });
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
  if (bookQ.isError || chQ.isError)
    return (
      <main className="min-h-[100dvh]">
        <ErrorState title="内容加载失败" subtitle="点击重试" onRetry={() => { bookQ.refetch(); chQ.refetch(); }} />
      </main>
    );
  if (!bookQ.data || !cur) return <div className="p-8 text-center text-ink-500">未找到内容</div>;

  const idx = chapters.findIndex((c) => c.id === cur.id);
  // 全书进度 =（已读完章节数 + 当前章滚动比例）/ 总章数：章内滚动也平滑前进，全部读完才 100
  const _total = chapters.length || 1;
  const _done = Math.min(readCh.length, chapters.length);
  const _curDone = cur ? readCh.includes(cur.id) : false;
  const _frac = _curDone ? 0 : Math.max(0, Math.min(1, pct / 100));
  const bookPct = _done >= chapters.length ? 100 : Math.min(99, Math.round(((_done + _frac) / _total) * 100));

  return (
    <main className={"relative min-h-[100dvh] " + bgCls}>
      <Motif name="bamboo" className="reader-deco h-24 w-24" />
      {/* 顶栏：返回 · 章标题（设置入口在底部工具栏最右） */}
      <header className="sticky top-0 z-20 flex h-14 items-center px-2 backdrop-blur" style={{ background: "transparent" }}>
        <button onClick={() => router.back()} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} />
        </button>
        <h1 className="flex-1 truncate text-center font-serif text-base">{chapterLabel(cur.no, cur.title)}</h1>
        <div className="w-10" />
      </header>

      {/* 正文：亮度作用于本区（含底色），并禁用浏览器原生长按菜单，避免与划线冲突 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={"h-[calc(100dvh-3.5rem-3.5rem)] overflow-y-auto px-6 pb-10 no-scrollbar " + bgCls}
        style={{ filter: `brightness(${reader.brightness})` }}
      >
        <div
          ref={contentRef}
          onContextMenu={(e) => e.preventDefault()}
          className="mx-auto max-w-[680px] break-words font-serif leading-[1.9]"
          style={{ fontSize: reader.fontSize, WebkitTouchCallout: "none" }}
        >
          {md}
        </div>
        <div className="mx-auto mt-8 flex max-w-[680px] justify-between">
          <button disabled={idx <= 0} onClick={() => setCurId(chapters[idx - 1].id)} className="rounded-full border border-current/20 px-4 py-1.5 text-xs disabled:pointer-events-none disabled:opacity-30">上一章</button>
          <button disabled={idx >= chapters.length - 1} onClick={() => setCurId(chapters[idx + 1].id)} className="rounded-full border border-current/20 px-4 py-1.5 text-xs disabled:pointer-events-none disabled:opacity-30">下一章</button>
        </div>
      </div>

      {/* 底部工具栏：目录 / 设置 / 笔记（图标区分明显） */}
      <div className="sticky bottom-0 z-20 border-t border-current/10 px-4 py-2 backdrop-blur">
        <div className="mb-1 text-center text-[11px] opacity-50">
          {chapterLabel(cur.no)} · 本章 {Math.round(pct)}% · 全书 {bookPct}%
        </div>
        <div className="flex items-center justify-around">
          <ToolBtn icon={<List size={18} />} label="目录" onClick={() => setToc(true)} />
          <ToolBtn icon={<StickyNote size={18} />} label="笔记" onClick={() => setNotesPanel(true)} />
          <ToolBtn icon={<Settings2 size={18} />} label="设置" onClick={() => setSettings(true)} />
        </div>
      </div>

      {/* 划线菜单 */}
      {menu && (
        <div
          ref={menuRef}
          className={"fixed z-50 w-max max-w-[96vw] -translate-x-1/2 " + (menu.below ? "" : "-translate-y-full")}
          style={{ left: menuX, top: menu.y }}
        >
          <div className="flex flex-nowrap items-center gap-1.5 rounded-2xl bg-snow/95 px-2.5 py-2 text-ink shadow-xl ring-1 ring-line backdrop-blur dark:bg-dark-card/95 dark:text-dark-text dark:ring-white/10">
            {HL_COLORS.map((c) => (
              <button key={c} onClick={() => doHighlight(c)} aria-label="高亮" className="h-7 w-7 shrink-0 rounded-full ring-1 ring-black/10 transition active:scale-90 dark:ring-white/20" style={{ background: c }} />
            ))}
            <span className="mx-0.5 h-5 w-px shrink-0 bg-line dark:bg-white/10" />
            <button onClick={openNote} aria-label="写笔记" className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-ink-700 transition active:bg-moon dark:text-dark-text/85 dark:active:bg-white/10"><PenLine size={14} /> 笔记</button>
            <button onClick={copySelection} aria-label="复制" className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-ink-700 transition active:bg-moon dark:text-dark-text/85 dark:active:bg-white/10"><Copy size={14} /> 复制</button>
          </div>
        </div>
      )}

      {/* 笔记输入浮层 */}
      <AnimatePresence>
        {notePanel && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setNotePanel(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
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
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
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

      {/* 本章笔记列表 */}
      <AnimatePresence>
        {notesPanel && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setNotesPanel(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 32 }} className="app-width relative rounded-t-[24px] bg-snow p-5 pb-safe shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
              <h3 className="mb-1 text-center font-serif text-base text-ink dark:text-dark-text">本章笔记</h3>
              <p className="mb-3 text-center text-[11px] text-ink-300">{chapterLabel(cur.no)} · 共 {chapterNotes.length} 条</p>
              {chapterNotes.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-ink-400 dark:text-dark-text/50">
                  <StickyNote size={28} className="text-celadon/40" />
                  本章还没有笔记
                  <span className="text-xs text-ink-300">长按正文选中文字，即可划线、写笔记</span>
                </div>
              ) : (
                <div className="max-h-[52vh] space-y-2.5 overflow-y-auto">
                  {chapterNotes.map((n) => (
                    <div key={n.id} className="flex items-start gap-2 rounded-xl bg-moon p-3 dark:bg-dark-bg">
                      <button onClick={() => { setNotesPanel(false); setActiveNote(n); }} className="min-w-0 flex-1 text-left">
                        <p className="rounded border-l-[3px] px-2 py-1 text-xs leading-5 text-ink-700 dark:text-dark-text/80" style={{ borderColor: n.color, background: n.color + "22" }}>{n.excerpt}</p>
                        {n.note && <p className="mt-1 line-clamp-2 px-1 text-sm text-ink dark:text-dark-text">{n.note}</p>}
                      </button>
                      <button onClick={() => { removeNote(n.id); toast("已删除"); }} aria-label="删除笔记" className="shrink-0 p-1 text-ink-300 active:scale-90">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 章节目录抽屉 */}
      <AnimatePresence>
        {toc && (
          <motion.div className="fixed inset-0 z-50 flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }} className="relative h-full w-[80%] max-w-[360px] overflow-y-auto bg-snow p-4 shadow-2xl ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
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
                      <span className={"text-sm " + (on ? "font-medium text-celadon" : "text-ink-700 dark:text-dark-text/85")}>{chapterLabel(c.no, c.title)}</span>
                      {on ? <span className="h-1.5 w-1.5 rounded-full bg-celadon" /> : readCh.includes(c.id) ? <Check size={14} className="text-ink-300" /> : null}
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

      {/* 阅读设置面板（字号 / 背景 / 亮度） */}
      <AnimatePresence>
        {settings && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/20" onClick={() => setSettings(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
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

// Markdown 渲染样式（新中式排版）；颜色继承当前阅读背景的文字色
const mdComponents: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-6 font-serif text-[1.45em] font-semibold tracking-wide">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2.5 mt-5 font-serif text-[1.25em] font-semibold tracking-wide">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 font-serif text-[1.12em] font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-3.5">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6 marker:text-celadon">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:text-celadon">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.8] [&>p]:my-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-4 border-l-[3px] border-celadon/50 pl-4 opacity-80">{children}</blockquote>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  hr: () => <hr className="my-7 border-0 border-t border-current/15" />,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-celadon underline underline-offset-2">{children}</a>,
  code: ({ children }) => <code className="rounded bg-current/10 px-1.5 py-0.5 font-sans text-[0.88em]">{children}</code>,
  img: () => null, // 阅读正文不渲染图片
};

/** 渲染后用 DOM 包裹方式给正文打高亮：以「可见文本偏移 + 摘录就近匹配」定位，跨粗体/标题等多元素也逐文本节点精确包裹 */
function applyHighlights(root: HTMLElement, notes: NoteItem[], onClick: (n: NoteItem) => void) {
  // 先卸掉旧 mark（还原文本），再按最新笔记重标，保证幂等
  root.querySelectorAll("mark[data-note]").forEach((m) => {
    const p = m.parentNode;
    if (!p) return;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
  });
  root.normalize(); // 合并相邻文本节点，保证偏移连续
  const full = root.textContent ?? "";
  const ranges: { start: number; end: number; note: NoteItem }[] = [];
  notes.forEach((n) => {
    if (!n.excerpt) return;
    const i = locate(full, n.excerpt, typeof n.start === "number" ? n.start : 0);
    if (i >= 0) ranges.push({ start: i, end: i + n.excerpt.length, note: n });
  });
  ranges.sort((a, b) => a.start - b.start);
  const clean: typeof ranges = [];
  let lastEnd = 0;
  for (const r of ranges) if (r.start >= lastEnd) { clean.push(r); lastEnd = r.end; }
  clean.forEach((r) => wrapRange(root, r, onClick));
}

function wrapRange(root: HTMLElement, r: { start: number; end: number; note: NoteItem }, onClick: (n: NoteItem) => void) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segs: { node: Text; from: number; to: number }[] = [];
  let offset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const len = t.nodeValue?.length ?? 0;
    const from = Math.max(r.start, offset) - offset;
    const to = Math.min(r.end, offset + len) - offset;
    if (from < to) segs.push({ node: t, from, to });
    offset += len;
  }
  segs.forEach((seg, idx) => {
    let target = seg.node;
    if (seg.from > 0) target = target.splitText(seg.from);
    if (seg.to - seg.from < (target.nodeValue?.length ?? 0)) target.splitText(seg.to - seg.from);
    const mark = document.createElement("mark");
    mark.setAttribute("data-note", r.note.id);
    if (idx === 0) mark.id = "mk-" + r.note.id; // 仅首段挂 id，供「我的笔记」跳转定位
    mark.className = "cursor-pointer rounded-[3px]";
    mark.style.background = r.note.color + "80";
    mark.style.color = "inherit";
    if (r.note.note) { mark.style.textDecoration = "underline dotted"; mark.style.textDecorationColor = r.note.color; mark.style.textUnderlineOffset = "3px"; }
    const parent = target.parentNode;
    if (!parent) return;
    parent.replaceChild(mark, target);
    mark.appendChild(target);
    mark.addEventListener("click", () => onClick(r.note));
  });
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
