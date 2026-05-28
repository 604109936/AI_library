"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Type, List, Palette, Volume2, Check } from "lucide-react";
import { getBook, getChapters } from "@/lib/api";
import { Skeleton } from "@/components/ui/States";
import { useLibrary, useReader, useUI, requireLogin, type ReaderBg } from "@/lib/store";
import type { Chapter } from "@/lib/types";

const HL_COLORS = ["#E7C66B", "#8FB39B", "#7FA6C9", "#D08FB0"];
const BG_OPTIONS: { key: ReaderBg; label: string; cls: string; swatch: string }[] = [
  { key: "white", label: "白", cls: "reader-bg-white", swatch: "#FFFFFF" },
  { key: "moon", label: "米黄", cls: "reader-bg-moon", swatch: "#F4F2ED" },
  { key: "green", label: "护眼绿", cls: "reader-bg-green", swatch: "#E8F0E4" },
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
  const setProgress = useLibrary((s) => s.setProgress);
  const pushHistory = useLibrary((s) => s.pushHistory);

  const bookQ = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });
  const chQ = useQuery({ queryKey: ["chapters", id], queryFn: () => getChapters(id) });
  const chapters = chQ.data ?? [];
  const [curId, setCurId] = useState<string | null>(null);
  const cur: Chapter | undefined =
    chapters.find((c) => c.id === (curId ?? sp.get("ch"))) ?? chapters[0];

  const [toc, setToc] = useState(false);
  const [settings, setSettings] = useState(false);
  const [brightness, setBrightness] = useState(1);
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [notePanel, setNotePanel] = useState<{ excerpt: string; color: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);

  const bgCls = BG_OPTIONS.find((b) => b.key === reader.bg)?.cls ?? "reader-bg-moon";

  // 记录历史 + 进度上报
  useEffect(() => {
    if (!bookQ.data || !cur) return;
    pushHistory({
      bookId: bookQ.data.id.split("__")[0],
      bookTitle: bookQ.data.title,
      coverSeed: bookQ.data.coverSeed,
      mode: "text",
      progress: Math.max(1, Math.round(pct)),
      lastAt: new Date().toISOString(),
    });
    // eslint-disable-next-line
  }, [cur?.id, bookQ.data?.id]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const p = (el.scrollTop / (el.scrollHeight - el.clientHeight || 1)) * 100;
    setPct(Math.min(100, Math.max(0, p)));
  }

  function onSelect() {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !contentRef.current) {
      setMenu(null);
      return;
    }
    try {
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      setMenu({ x: rect.left + rect.width / 2, y: rect.top, text });
    } catch {
      setMenu(null);
    }
  }

  function doHighlight(color: string) {
    const text = menu?.text ?? "";
    requireLogin(() => {
      addNote({
        id: "n" + Date.now(),
        bookId: bookQ.data!.id.split("__")[0],
        bookTitle: bookQ.data!.title,
        bookCoverSeed: bookQ.data!.coverSeed,
        chapterId: cur!.id,
        chapterTitle: `第${cur!.no}章 ${cur!.title}`,
        excerpt: text,
        note: "",
        color,
        createdAt: new Date().toISOString(),
      });
      toast("已高亮");
    });
    setMenu(null);
    window.getSelection()?.removeAllRanges();
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
      addNote({
        id: "n" + Date.now(),
        bookId: bookQ.data!.id.split("__")[0],
        bookTitle: bookQ.data!.title,
        bookCoverSeed: bookQ.data!.coverSeed,
        chapterId: cur!.id,
        chapterTitle: `第${cur!.no}章 ${cur!.title}`,
        excerpt: notePanel.excerpt,
        note: noteText,
        color: notePanel.color,
        createdAt: new Date().toISOString(),
      });
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
    <main className={"relative min-h-[100dvh] " + bgCls} style={{ filter: `brightness(${brightness})` }}>
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 flex h-14 items-center px-2 backdrop-blur" style={{ background: "transparent" }}>
        <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} />
        </button>
        <h1 className="flex-1 truncate text-center font-serif text-base">第{cur.no}章 {cur.title}</h1>
        <button onClick={() => setSettings(true)} className="flex h-10 w-10 items-center justify-center rounded-full font-serif">
          <Type size={20} />
        </button>
      </header>

      {/* 正文 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-[calc(100dvh-3.5rem-3.5rem)] overflow-y-auto px-6 pb-10 no-scrollbar"
      >
        <div
          ref={contentRef}
          onMouseUp={onSelect}
          onTouchEnd={onSelect}
          className="mx-auto max-w-[680px] whitespace-pre-wrap font-serif leading-[1.9]"
          style={{ fontSize: reader.fontSize }}
        >
          {cur.content}
        </div>
        {/* 上/下章 */}
        <div className="mx-auto mt-8 flex max-w-[680px] justify-between">
          <button
            disabled={idx <= 0}
            onClick={() => { setCurId(chapters[idx - 1].id); scrollRef.current?.scrollTo(0, 0); }}
            className="rounded-full border border-current/20 px-4 py-1.5 text-xs disabled:opacity-30"
          >
            上一章
          </button>
          <button
            disabled={idx >= chapters.length - 1}
            onClick={() => { setCurId(chapters[idx + 1].id); scrollRef.current?.scrollTo(0, 0); }}
            className="rounded-full border border-current/20 px-4 py-1.5 text-xs disabled:opacity-30"
          >
            下一章
          </button>
        </div>
      </div>

      {/* 底部工具栏 */}
      <div className="sticky bottom-0 z-20 border-t border-current/10 px-4 py-2 backdrop-blur">
        <div className="mb-1 text-center text-[11px] opacity-50">
          本章 {Math.round(pct)}% · 全书 {Math.round(((idx + pct / 100) / chapters.length) * 100)}%
        </div>
        <div className="flex items-center justify-around">
          <ToolBtn icon={<List size={18} />} label="目录" onClick={() => setToc(true)} />
          <ToolBtn icon={<Type size={18} />} label="字号" onClick={() => setSettings(true)} />
          <ToolBtn icon={<Palette size={18} />} label="背景" onClick={() => setSettings(true)} />
          <ToolBtn icon={<Volume2 size={18} />} label="朗读" onClick={() => toast("朗读功能即将上线", "info")} />
        </div>
      </div>

      {/* 划线菜单 */}
      {menu && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full"
          style={{ left: Math.min(Math.max(menu.x, 90), (typeof window !== "undefined" ? window.innerWidth : 360) - 90), top: menu.y - 8 }}
        >
          <div className="rounded-xl bg-ink px-2 py-2 text-snow shadow-lg">
            <div className="flex items-center gap-3 px-1 text-xs">
              <button onClick={() => doHighlight(HL_COLORS[0])}>高亮</button>
              <button onClick={openNote}>笔记</button>
              <button onClick={() => { navigator.clipboard?.writeText(menu.text); toast("已复制"); setMenu(null); }}>复制</button>
              <button onClick={() => { toast("分享功能即将上线", "info"); setMenu(null); }}>分享</button>
            </div>
            <div className="mt-2 flex items-center justify-center gap-2">
              {HL_COLORS.map((c) => (
                <button key={c} onClick={() => doHighlight(c)} className="h-4 w-4 rounded-full" style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 笔记输入浮层 */}
      <AnimatePresence>
        {notePanel && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setNotePanel(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-xl bg-snow p-5 dark:bg-dark-card">
              <p className="mb-2 rounded-lg border-l-[3px] border-celadon bg-celadon-soft/40 px-3 py-2 text-xs text-ink-700">{notePanel.excerpt}</p>
              <textarea
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="写下你的笔记…"
                className="h-24 w-full resize-none rounded-lg border border-line bg-moon p-3 text-sm text-ink outline-none focus:border-celadon dark:bg-dark-bg dark:text-dark-text"
              />
              <button onClick={saveNote} className="mt-3 w-full rounded-xl bg-celadon py-2.5 text-sm text-snow active:scale-[0.99]">保存</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 章节目录抽屉 */}
      <AnimatePresence>
        {toc && (
          <motion.div className="fixed inset-0 z-50 flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="relative h-full w-[78%] max-w-[360px] overflow-y-auto bg-snow p-4 dark:bg-dark-card"
            >
              <h2 className="font-serif text-lg text-ink dark:text-dark-text">目录</h2>
              <p className="mt-0.5 text-xs text-ink-300">{bookQ.data.title} · 共 {chapters.length} 章</p>
              <div className="mt-3 divide-y divide-line">
                {chapters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setCurId(c.id); setToc(false); scrollRef.current?.scrollTo(0, 0); }}
                    className="flex w-full items-center justify-between py-2.5 text-left"
                  >
                    <span className={"text-sm " + (c.id === cur.id ? "text-celadon" : "text-ink-700 dark:text-dark-text")}>
                      第{c.no}章 {c.title}
                    </span>
                    {c.id === cur.id ? <span className="h-1.5 w-1.5 rounded-full bg-celadon" /> : c.status === "read" ? <Check size={14} className="text-ink-300" /> : null}
                  </button>
                ))}
              </div>
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
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-xl bg-snow p-5 dark:bg-dark-card">
              <h3 className="mb-3 text-center font-serif text-base text-ink dark:text-dark-text">阅读设置</h3>
              <Row label="字号">
                <div className="flex gap-2">
                  {FONT_STEPS.map((f, i) => (
                    <button key={f} onClick={() => reader.setFontSize(f)} className={"rounded-lg px-3 py-1 text-sm " + (reader.fontSize === f ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg")}>{FONT_LABEL[i]}</button>
                  ))}
                </div>
              </Row>
              <Row label="背景">
                <div className="flex gap-3">
                  {BG_OPTIONS.map((b) => (
                    <button key={b.key} onClick={() => reader.setBg(b.key)} className="flex flex-col items-center gap-1">
                      <span className={"h-8 w-8 rounded-full border-2 " + (reader.bg === b.key ? "border-celadon" : "border-line")} style={{ background: b.swatch }} />
                      <span className="text-[10px] text-ink-500">{b.label}</span>
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="翻页方式">
                <div className="flex gap-2">
                  {(["scroll", "page"] as const).map((m) => (
                    <button key={m} onClick={() => reader.setPageMode(m)} className={"rounded-lg px-3 py-1 text-sm " + (reader.pageMode === m ? "bg-celadon text-snow" : "bg-moon text-ink-500 dark:bg-dark-bg")}>{m === "scroll" ? "滚动" : "翻页"}</button>
                  ))}
                </div>
              </Row>
              <Row label="亮度">
                <input type="range" min={0.5} max={1} step={0.02} value={brightness} onChange={(e) => setBrightness(+e.target.value)} className="w-44 accent-celadon" />
              </Row>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function ToolBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 opacity-80">
      {icon}
      <span className="text-[10px]">{label}</span>
    </button>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-ink-500">{label}</span>
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
