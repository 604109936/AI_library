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
import { useReadCountBump, useReadingClock } from "@/lib/useReadingClock";
import { useGoBack } from "@/components/shell/Header";
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

/**
 * P0-1 跨段落划线：把 Range 边界 (container, offset) 映射为 root.textContent 坐标系的绝对偏移。
 * Selection.toString() 在跨段落处会按「渲染文本」插入 "\n\n"，而 textContent 是文本节点 data 的纯拼接，
 * 二者坐标系不同——曾导致 indexOf 必 -1、跨段划线落库却永不显示。这里用 TreeWalker 按文本节点逐个累加，
 * 与 applyHighlights/wrapRange 的偏移口径严格一致。
 * 手测步骤：长按从某段末尾选到下一段开头 → 划线 → 标记必须立即完整出现且刷新后仍在（亦有 playwright 自测覆盖）。
 */
function rangePointToOffset(root: HTMLElement, container: Node, offset: number): number {
  // 归一化边界：文本容器 =（该文本节点, 节点内偏移）；元素容器 = 第 offset 个子节点之前（越界则为容器末尾）
  let textNode: Text | null = null;
  let innerOff = 0;
  let beforeNode: Node | null = null;
  if (container.nodeType === Node.TEXT_NODE) {
    textNode = container as Text;
    innerOff = offset;
  } else {
    beforeNode = container.childNodes[offset] ?? null;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (textNode) {
      if (n === textNode) return acc + Math.min(innerOff, (n as Text).nodeValue?.length ?? 0);
    } else if (beforeNode) {
      // 边界位于 beforeNode 之前：首个「在 beforeNode 内或其后」的文本节点出现时即到达边界
      const rel = beforeNode.compareDocumentPosition(n);
      if (n === beforeNode || rel & Node.DOCUMENT_POSITION_CONTAINED_BY || rel & Node.DOCUMENT_POSITION_FOLLOWING) return acc;
    } else {
      // 边界位于 container 末尾：container 内的文本继续累加，越过 container 即到达边界
      const rel = container.compareDocumentPosition(n);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING && !(rel & Node.DOCUMENT_POSITION_CONTAINED_BY)) return acc;
    }
    acc += (n as Text).nodeValue?.length ?? 0;
  }
  return textNode ? -1 : acc; // 文本容器不在 root 内 → -1；元素边界在全部文本之后 → 总长
}

const HL_COLORS = ["#8FB39B", "#D9C08A", "#D69A95", "#C9C6BE"]; // 青瓷/黄铜/胭脂/淡墨
const HL_NAMES = ["青瓷", "黄铜", "胭脂", "淡墨"];
const LAST_COLOR_KEY = "ail-last-hl-color";
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
  const goBack = useGoBack();
  const sp = useSearchParams();
  const toast = useUI((s) => s.toast);
  const reader = useReader();
  const addNote = useLibrary((s) => s.addNote);
  const removeNote = useLibrary((s) => s.removeNote);
  const updateNote = useLibrary((s) => s.updateNote);
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
  // menu.copy 保留选区的「渲染文本」（含段落换行）仅用于复制；text/start/end 与 textContent 严格一致用于落库
  const [menu, setMenu] = useState<{ x: number; y: number; text: string; copy: string; below: boolean; start: number; end: number } | null>(null);
  const [menuX, setMenuX] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  // editId 存在 = 编辑已有划线的想法（保存走 updateNote）；否则为新建（保存走 addNote）
  const [notePanel, setNotePanel] = useState<{ excerpt: string; color: string; start: number; editId?: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [activeNote, setActiveNote] = useState<NoteItem | null>(null);
  const [chrome, setChrome] = useState(true); // B2 沉浸模式：false = 顶栏/底栏隐藏
  const [lastColor, setLastColor] = useState(HL_COLORS[0]); // B4 记住上次划线用色
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const pctRef = useRef(0);
  const lastProgSig = useRef(""); // 进度写库去重：相同(章+pct)不重复 upsert text_progress（停在某页不动时省掉每 5 秒一次的冗余写）
  const resumed = useRef(false);
  // 续读决议完成才放行进度上报：否则进入瞬间会以默认第 1 章抢跑一轮 report——
  // 覆写 ail-chpos 精确位置、向云端写错章进度（刷新场景下水合晚于章节数据时必现）
  const [resolved, setResolved] = useState(false);
  const pendingPct = useRef<{ ch: string; pct: number } | null>(null); // P2-8 续读待恢复的章内滚动比例
  useEffect(() => {
    try {
      const c = localStorage.getItem(LAST_COLOR_KEY);
      if (c && HL_COLORS.includes(c)) setLastColor(c);
    } catch {}
  }, []);
  useReadingClock(!!cur); // 文字阅读时长计入「我的-总时长」

  const bgCls = BG_OPTIONS.find((b) => b.key === reader.bg)?.cls ?? "reader-bg-moon";
  const realId = id.split("__")[0];
  useReadCountBump(realId, !!cur); // 「一次阅读」计数（正文阅读满30秒记一次，存但不展示）
  const readCh = readChapters[realId] ?? [];
  const chapterNotes = cur ? notes.filter((n) => n.bookId === realId && n.chapterId === cur.id) : [];

  // Markdown 渲染：按「章节内容」memo，使笔记/其它状态变化时不重渲染正文 DOM（我们对其做命令式高亮，才不会被 React 协调冲掉）
  const md = useMemo(
    () => <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]} components={mdComponents}>{cur?.content ?? ""}</ReactMarkdown>,
    [cur?.content]
  );
  // 渲染（含切章）后给正文打高亮；笔记增删/背景切换时重标（深灰底高亮配色不同，见 P2-15）
  useIsoLayoutEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const ns = cur ? notes.filter((n) => n.bookId === realId && n.chapterId === cur.id) : [];
    applyHighlights(root, ns, setActiveNote, reader.bg === "dark");
  }, [cur?.id, cur?.content, notes, realId, reader.bg]);

  // B2：切章自动恢复顶栏/底栏显示
  useEffect(() => { setChrome(true); }, [cur?.id]);

  // P2-7：目录抽屉打开后，把当前章滚到抽屉视野中央（等 spring 入场大半完成再滚，一次性）
  useEffect(() => {
    if (!toc) return;
    const t = setTimeout(() => document.getElementById("toc-cur")?.scrollIntoView({ block: "center" }), 120);
    return () => clearTimeout(t);
  }, [toc]);

  // 续读必须等 useLibrary.load() 完成（hydrated）：否则读到空 progress 落回第 1 章，
  // 随之而来的上报还会把云端续读位置覆盖掉（Review P0；写穿透侧另有 hydrated 门禁双保险）
  const libHydrated = useLibrary((s) => s.hydrated);
  useEffect(() => {
    if (resumed.current || !chapters.length || !libHydrated) return;
    resumed.current = true;
    // resolved 置位放 finally：所有决议路径（带 ?ch 直达、无保存进度、正常恢复）都要放行进度上报
    try {
      if (curId || sp.get("ch")) return;
      const saved = useLibrary.getState().progress[id.split("__")[0]];
      if (!saved?.chapterId || !chapters.some((c) => c.id === saved.chapterId)) return;
      setCurId(saved.chapterId);
      // P2-8 续读恢复章内位置：优先本机记录的「章内滚动百分比」（report 时落 localStorage，精确）；
      // 没有则用全书进度反解章内比例兜底（全书 pct 取整有误差，仅作近似）。有 ?mark 时让位给标记定位。
      if (sp.get("mark")) return;
      let p = -1;
      try {
        const raw = localStorage.getItem("ail-chpos-" + realId);
        if (raw) {
          const v = JSON.parse(raw);
          if (v?.ch === saved.chapterId && typeof v.pct === "number") p = v.pct;
        }
      } catch {}
      if (p < 0 && typeof saved.pct === "number") {
        const total = chapters.length || 1;
        const done = (useLibrary.getState().readChapters[realId] ?? []).length;
        p = Math.max(0, Math.min(1, (saved.pct / 100) * total - done)) * 100;
      }
      if (p > 0) pendingPct.current = { ch: saved.chapterId, pct: Math.min(100, p) };
    } finally {
      setResolved(true);
    }
    // eslint-disable-next-line
  }, [chapters, curId, sp, id, libHydrated]);

  useEffect(() => {
    if (!bookQ.data || !cur || !resolved) return; // 续读未决议前不上报（防默认第 1 章抢跑写脏进度）
    // 切章/进入：先回顶再重置本章进度，原子一致（旧章进度已由上一次 cleanup 写入，不受本次影响）
    scrollRef.current?.scrollTo(0, 0);
    pctRef.current = 0;
    setPct(0);
    const b = bookQ.data;
    const report = (allowMark: boolean) => {
      const rid = b.id.split("__")[0];
      const el = scrollRef.current;
      // 本章读毕：滚到底(≥95%) 或 内容不足一屏（无需滚动）。只在「容器活着」时判定：
      // 卸载时 el 已为 null（max 会算成 0）、切章 cleanup 时 DOM 已换成新章内容（max 不可信），
      // 二者都曾导致"没读完退出也被打√"，故 cleanup 一律不判读毕（只落进度），见下方 report(false)。
      if (allowMark && el) {
        const max = el.scrollHeight - el.clientHeight;
        if (pctRef.current >= 95 || max <= 4) markChapterRead(rid, cur.id);
      }
      // P2-8：本机另存「当前章 + 章内滚动百分比」，续读时精确恢复章内位置（不动 store 结构）。
      // 待恢复的精确位置还没应用时（恢复 effect 晚于本 effect 跑）不写：会把它覆盖成 pct=0
      if (!pendingPct.current) try { localStorage.setItem("ail-chpos-" + rid, JSON.stringify({ ch: cur.id, pct: Math.round(pctRef.current * 10) / 10 })); } catch {}
      const readNow = useLibrary.getState().readChapters[rid] ?? [];
      const N = chapters.length || 1;
      // 进度 =（已读完章节数 + 当前章滚动比例）/ 总章数：章内滚动也前进，全部读完才 100
      const doneN = Math.min(readNow.length, chapters.length);
      const curDone = readNow.includes(cur.id);
      const frac = curDone ? 0 : Math.max(0, Math.min(1, pctRef.current / 100));
      // 多章书读早期章节时 (doneN+frac)/N 取整可能为 0（30 章读第1章14%→round(0.47)=0），使"继续阅读"/详情页"在读"
      // 都识别不到（h.progress>0 / pct>0 失败）——用户其实正在读。有真实阅读（已读完≥1章 或 当前章有滚动）就把
      // 全书 pct 钳到下限 1；纯打开未滚（doneN=0 且 frac=0）仍为 0，不进继续阅读，保持既有口径。
      const raw = Math.round(((doneN + frac) / N) * 100);
      const prog = doneN >= chapters.length ? 100 : (doneN > 0 || frac > 0) ? Math.min(99, Math.max(1, raw)) : 0;
      pushHistory({ bookId: rid, bookTitle: b.title, author: b.author, coverSeed: b.coverSeed, cover: b.cover, mode: "text", progress: prog, lastAt: new Date().toISOString() });
      // 仅当(章+全书pct)较上次真有变化才写 text_progress：停在某页不滚动时 prog 不变 → 跳过冗余 upsert（省配额省电）
      const progSig = `${cur.id}|${prog}`;
      if (lastProgSig.current !== progSig) {
        lastProgSig.current = progSig;
        setProgress({ bookId: rid, chapterId: cur.id, chapterNo: cur.no, pct: prog, mode: "text" });
      }
    };
    report(false); // 进入：只记进度，不判读毕
    // 内容不足一屏的短章（前言/极短章）永不发 scroll 事件，onScroll 的 max<=4 分支触发不了，只能等 5s 定时器——
    // 用户 5 秒内翻页该章就永久不计读毕、全书卡 99%、分类页永不"已读"。入场即检测：全部可见(无可滚动余量)就安全判读毕。
    const rafShort = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el && el.scrollHeight - el.clientHeight <= 4) markChapterRead(b.id.split("__")[0], cur.id);
    });
    const t = setInterval(() => report(true), 5000); // 读毕只由「活着的」路径判定：此定时器 + onScroll
    return () => { cancelAnimationFrame(rafShort); report(false); clearInterval(t); }; // 退出/切章：只落进度，不判读毕（防误打√）
    // eslint-disable-next-line
  }, [cur?.id, bookQ.data?.id, resolved]);

  // P2-8：内容渲染后按保存的章内百分比恢复滚动（仅续读路径、仅一次）。
  // 必须声明在上面的进度 effect 之后：同一轮提交里先 scrollTo(0,0) 再恢复位置，不被回顶冲掉
  useEffect(() => {
    const t = pendingPct.current;
    if (!t || !cur || cur.id !== t.ch) return;
    const el = scrollRef.current;
    if (!el) { pendingPct.current = null; return; }
    // 单次 scrollTop 会被随后加载的图片/网络字体撑高布局挤偏（首帧按未含图高度算的位置偏上），
    // 且这次编程滚动触发的 onScroll 会把偏上的位置当用户滚动写回、覆盖正确续读点，越读越靠前。
    // 多次校准（rAF + 120ms + 400ms）盖过布局位移；校准全程保留 pendingPct，让进度 effect 据它跳过 chpos 写回，末拍才清。
    const apply = () => { const max = el.scrollHeight - el.clientHeight; if (max > 0) el.scrollTop = (t.pct / 100) * max; };
    const r = requestAnimationFrame(apply);
    const t1 = setTimeout(apply, 120);
    const t2 = setTimeout(() => { apply(); pendingPct.current = null; }, 400);
    return () => { cancelAnimationFrame(r); clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line
  }, [cur?.id, cur?.content]);

  // 从「我的笔记」跳转：轮询等高亮渲染好（应对数据水合/渲染延迟）再滚动到对应标记并轻闪一下。
  // 只定位一次：URL 上的 ?mark 会残留，切章往返时若重复定位会反复劫持阅读位置
  const markDone = useRef(false);
  useEffect(() => {
    const mk = sp.get("mark");
    if (!mk || !cur || markDone.current) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const el = document.getElementById("mk-" + mk);
      if (el) {
        markDone.current = true;
        el.scrollIntoView({ block: "center", behavior: "auto" }); // 直接定位，不做平滑滚动动画
        el.animate?.([{ filter: "brightness(1.45)" }, { filter: "brightness(1)" }], { duration: 1200, easing: "ease-out" });
        return;
      }
      if (++tries < 25) { timer = setTimeout(tick, 150); return; } // 最多约 3.75s 等渲染/水合
      // 兜底（Bug#17）：被外层划线完全包含的重叠划线在正文无独立 mk 锚点，轮询必失败 →
      // 改按该笔记摘录在正文中的位置滚过去，杜绝「我的笔记点进去无反应」
      markDone.current = true;
      const note = useLibrary.getState().notes.find((n) => n.id === mk);
      const root = contentRef.current;
      if (!note || !root) return;
      const full = root.textContent ?? "";
      const at = locate(full, note.excerpt, typeof note.start === "number" ? note.start : 0);
      if (at < 0) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let acc = 0; let tn: Node | null;
      while ((tn = walker.nextNode())) {
        const len = (tn as Text).nodeValue?.length ?? 0;
        if (at < acc + len) { (tn.parentElement as HTMLElement | null)?.scrollIntoView({ block: "center" }); break; }
        acc += len;
      }
    };
    timer = setTimeout(tick, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line
  }, [cur?.id, sp]);

  function onScroll() {
    if (menu) setMenu(null); // P2-10：滚动时收起划线菜单（位置已不再对得上选区）
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const p = (el.scrollTop / (max || 1)) * 100;
    const clamped = Math.min(100, Math.max(0, p));
    pctRef.current = clamped; // 上报用精确值
    // 渲染按整数百分比降频：未取整的浮点每个滚动事件都触发整个 ReaderInner 重渲染（含 framer 顶底栏），
    // 长章节滚动掉帧+耗电；取整后从每帧一次降到每 1% 一次
    setPct((prev) => (Math.round(prev) === Math.round(clamped) ? prev : Math.round(clamped)));
    // 滚到底(≥95%) 或 内容不足一屏(无需滚动) 即记为本章读毕（与定时上报口径一致）
    if ((clamped >= 95 || max <= 4) && bookQ.data && cur) markChapterRead(realId, cur.id);
  }

  function readSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !contentRef.current || !cur) { setMenu(null); return; }
    const root = contentRef.current;
    // 选区必须落在正文内（排除笔记输入框等其它选区）
    if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) { setMenu(null); return; }
    try {
      const range = sel.getRangeAt(0);
      // P0-1：用 TreeWalker 把选区两端映射成 textContent 坐标系的绝对偏移——跨段落选区也精确。
      // 旧实现用 sel.toString()（跨段插 "\n\n"）去 textContent 里 indexOf，跨段必 -1 → 划线落库却永不显示
      const full = root.textContent ?? "";
      let start = rangePointToOffset(root, range.startContainer, range.startOffset);
      let end = rangePointToOffset(root, range.endContainer, range.endOffset);
      if (start < 0 || end < 0) { setMenu(null); return; }
      // trim 两端空白并同步修正偏移：落库的 excerpt/start/end 与 textContent 严格一致
      while (start < end && /\s/.test(full[start])) start++;
      while (end > start && /\s/.test(full[end - 1])) end--;
      if (end <= start) { setMenu(null); return; }
      const text = full.slice(start, end); // 落库真值
      const copy = sel.toString().trim() || text; // 复制用渲染文本（保留段落换行）
      const rect = range.getBoundingClientRect();
      const below = rect.top < 110;
      setMenu({ x: rect.left + rect.width / 2, y: below ? rect.bottom + 10 : rect.top - 10, text, copy, below, start, end });
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
  // P1-3：新划线与本章已有划线求交（按 applyHighlights 同款 locate 解析实际落位），重叠则不落库，杜绝幽灵笔记。
  // 必须读 getState() 最新值而非渲染闭包：未登录时本地 notes 为空、校验形同虚设，
  // 登录成功后挂起回调执行时云端划线已同步回来——基于最新数据再查一次才真正堵住重叠落库
  function overlapsExisting(start: number, end: number): boolean {
    const full = contentRef.current?.textContent ?? "";
    const ns = useLibrary.getState().notes.filter((n) => n.bookId === realId && n.chapterId === cur?.id);
    return ns.some((n) => {
      if (!n.excerpt) return false;
      const s = locate(full, n.excerpt, typeof n.start === "number" ? n.start : 0);
      return s >= 0 && start < s + n.excerpt.length && end > s;
    });
  }
  // B4：记住上次划线用色（排在色板首位，下次默认）
  function rememberColor(c: string) {
    setLastColor(c);
    try { localStorage.setItem(LAST_COLOR_KEY, c); } catch {}
  }
  // 选区命中的全部既有划线（读 getState 最新值——登录回调时云端数据才同步回来）
  function overlappingNotes(start: number, end: number): NoteItem[] {
    const full = contentRef.current?.textContent ?? "";
    return useLibrary.getState().notes.filter((n) => {
      if (n.bookId !== realId || n.chapterId !== cur?.id || !n.excerpt) return false;
      const s = locate(full, n.excerpt, typeof n.start === "number" ? n.start : 0);
      return s >= 0 && start < s + n.excerpt.length && end > s;
    });
  }
  function doHighlight(color: string) {
    if (!menu) return;
    const { text, start, end } = menu;
    if (!text) { setMenu(null); return; }
    setMenu(null);
    window.getSelection()?.removeAllRanges();
    // 与既有划线重叠不再拒绝，改「并集合并扩展」：把已有划线扩选更长是最自然的动作，
    // 原 toast 打断是高亮交互最大的别扭点。删旧划线 → 以区间并集新建（想法合并保留、用新选的颜色）；
    // 在登录回调内整体执行，游客登录后以最新云端数据计算，天然不产生重叠落库（幽灵笔记）
    requireLogin(() => {
      const hits = overlappingNotes(start, end);
      if (!hits.length) {
        addNote(makeNote(text, "", color, start));
        rememberColor(color);
        toast("已划线");
        return;
      }
      const full = contentRef.current?.textContent ?? "";
      let s = start, e = end;
      for (const n of hits) {
        const i = locate(full, n.excerpt, typeof n.start === "number" ? n.start : 0);
        if (i >= 0) { s = Math.min(s, i); e = Math.max(e, i + n.excerpt.length); }
      }
      const thought = hits.map((n) => n.note).filter(Boolean).join("\n");
      hits.forEach((n) => removeNote(n.id));
      addNote(makeNote(full.slice(s, e), thought, color, s));
      rememberColor(color);
      toast(hits.length > 1 ? "已合并多条划线" : "已与原划线合并");
    });
  }
  function openNote() {
    if (!menu) return;
    const m = menu;
    setMenu(null);
    if (overlapsExisting(m.start, m.end)) { window.getSelection()?.removeAllRanges(); toast("这段已有划线，点击原划线可修改"); return; }
    // 与「划线」一致：先校验登录，避免未登录写完笔记点保存才弹登录、输入被清空
    requireLogin(() => {
      if (overlapsExisting(m.start, m.end)) { window.getSelection()?.removeAllRanges(); toast("这段已有划线，点击原划线可修改"); return; }
      setNotePanel({ excerpt: m.text, color: lastColor, start: m.start });
      setNoteText("");
    });
  }
  // P1-2：点已有划线 → 换色 = 删旧 + 以同 excerpt/start/end/原想法新建（store 无改色接口，不动 store）
  function recolorNote(c: string) {
    if (!activeNote || c === activeNote.color) return;
    const nn: NoteItem = { ...activeNote, id: uid(), color: c };
    removeNote(activeNote.id);
    addNote(nn);
    rememberColor(c);
    setActiveNote(nn);
  }
  // P1-2：写想法/编辑想法 → 复用笔记浮层，预填原想法，保存走 updateNote
  function editThought() {
    if (!activeNote) return;
    const n = activeNote;
    setActiveNote(null);
    requireLogin(() => {
      setNotePanel({ excerpt: n.excerpt, color: n.color, start: typeof n.start === "number" ? n.start : -1, editId: n.id });
      setNoteText(n.note);
    });
  }
  function copySelection() {
    const t = menu?.copy ?? "";
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
    const p = notePanel;
    const text = noteText;
    if (p.editId) {
      // 编辑已有划线的想法：只更新 note 文本（划线/颜色不动）
      requireLogin(() => { updateNote(p.editId!, text); toast("笔记已更新"); });
    } else {
      requireLogin(() => {
        // 会话过期重登路径的兜底复查（与 doHighlight 同理：登录后才看得到云端既有划线）
        if (typeof p.start === "number" && p.start >= 0 && overlapsExisting(p.start, p.start + p.excerpt.length)) {
          toast("这段已有划线，点击原划线可修改");
          return;
        }
        addNote(makeNote(p.excerpt, text, p.color, p.start)); rememberColor(p.color); toast("笔记已保存");
      });
    }
    setNotePanel(null);
    window.getSelection()?.removeAllRanges();
  }
  // P2-9：用户主动切章时同步 URL（刷新落在当前章）；replaceState 不进历史栈，
  // 仅在用户点上一/下一章与目录时调用——续读/深链初始化不动 URL，与既有逻辑不打架；顺带丢掉残留的 ?mark
  function gotoChapter(cid: string) {
    if (cid === cur?.id) return;
    // 同步清掉旧章的划线菜单与选区：menu 里缓存的 text/start/end 基于旧章 textContent，
    // 等 selectionchange 防抖链路（约 130ms）去收会留窗口——窗口内点颜色会以旧偏移在新章落幽灵笔记
    setMenu(null);
    window.getSelection()?.removeAllRanges();
    setCurId(cid);
    try { window.history.replaceState(null, "", "?ch=" + cid); } catch {}
  }
  // B2 沉浸模式：点正文「纵向中部 1/3」区域切换顶栏/底栏显隐；菜单或任一浮层开着、点在交互元素上、有选区时不触发
  function onContentClick(e: React.MouseEvent) {
    if (menu || notePanel || activeNote || notesPanel || toc || settings) return;
    const t = e.target as HTMLElement;
    if (t.closest("mark,button,a,textarea,input")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const h = window.innerHeight;
    if (e.clientY < h / 3 || e.clientY > (h * 2) / 3) return;
    setChrome((v) => !v);
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
  // 书不存在/无章节：给文案与出路（原来是无任何按钮的死页）
  if (!bookQ.data || !cur)
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="font-serif text-lg text-ink dark:text-dark-text">未找到可阅读的内容</p>
        <p className="text-sm text-ink-500 dark:text-dark-text/55">这本书可能没有文字稿，或已被移走</p>
        <button onClick={() => router.push("/library")} className="rounded-full bg-celadon px-6 py-2.5 text-sm text-snow active:scale-95">回到泡馆</button>
      </main>
    );

  const idx = chapters.findIndex((c) => c.id === cur.id);
  // 全书进度 =（已读完章节数 + 当前章滚动比例）/ 总章数：章内滚动也平滑前进，全部读完才 100
  const _total = chapters.length || 1;
  const _done = Math.min(readCh.length, chapters.length);
  const _curDone = cur ? readCh.includes(cur.id) : false;
  const _frac = _curDone ? 0 : Math.max(0, Math.min(1, pct / 100));
  const bookPct = _done >= chapters.length ? 100 : Math.min(99, Math.round(((_done + _frac) / _total) * 100));

  return (
    /* P2-5 高度预算：固定 100dvh 纵向 flex，顶栏/底栏自然高度，正文 flex-1 滚动，不再手工 calc */
    <main className={"relative flex h-[100dvh] flex-col " + bgCls}>
      <Motif name="bamboo" className="reader-deco h-24 w-24" />
      {/* B2 沉浸模式：栏隐藏时顶部留 1.5px 细进度线（宽 = 本章进度） */}
      {!chrome && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30">
          <div className="h-[1.5px] bg-celadon" style={{ width: pct + "%" }} />
        </div>
      )}
      {/* 顶栏：返回 · 章标题（设置入口在底部工具栏最右） */}
      <AnimatePresence initial={false}>
        {chrome && (
          <motion.header
            key="topbar"
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="z-20 flex h-14 shrink-0 items-center px-2 backdrop-blur"
            style={{ background: "transparent" }}
          >
            <button onClick={goBack} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
              <ChevronLeft size={24} />
            </button>
            <h1 className="flex-1 truncate text-center font-serif text-base">{chapterLabel(cur.no, cur.title)}</h1>
            <div className="w-10" />
          </motion.header>
        )}
      </AnimatePresence>

      {/* 正文：亮度作用于本区（含底色），并禁用浏览器原生长按菜单，避免与划线冲突 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={onContentClick}
        className={"min-h-0 flex-1 overflow-y-auto px-6 pb-10 no-scrollbar " + bgCls}
        style={{ filter: `brightness(${reader.brightness})` }}
      >
        <div
          key={cur.id} // 按章整棵重挂载：高亮 wrapRange 对 React 托管文本节点做过 splitText/包 mark，
          // 切章若让 React 原地 diff 被命令式改动过的 DOM，会抛 NotFoundError 白屏或残留上一章文字碎片
          ref={contentRef}
          onContextMenu={(e) => e.preventDefault()}
          className="mx-auto max-w-[680px] break-words text-justify font-serif leading-[1.9]"
          style={{ fontSize: reader.fontSize, WebkitTouchCallout: "none" }}
        >
          {md}
        </div>
        <div className="mx-auto mt-8 flex max-w-[680px] justify-between">
          <button disabled={idx <= 0} onClick={() => gotoChapter(chapters[idx - 1].id)} className="relative rounded-full border border-current/20 px-4 py-1.5 text-xs before:absolute before:-inset-1.5 before:content-[''] disabled:pointer-events-none disabled:opacity-30">上一章</button>
          <button disabled={idx >= chapters.length - 1} onClick={() => gotoChapter(chapters[idx + 1].id)} className="relative rounded-full border border-current/20 px-4 py-1.5 text-xs before:absolute before:-inset-1.5 before:content-[''] disabled:pointer-events-none disabled:opacity-30">下一章</button>
        </div>
        {/* B3 读毕仪式卡：仅最后一章且该章读毕时出现（复用既有读毕状态 readCh） */}
        {idx === chapters.length - 1 && readCh.includes(cur.id) && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="mx-auto mt-12 flex max-w-[680px] flex-col items-center gap-3 pb-6 text-center"
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-rouge/65 font-serif text-2xl font-semibold tracking-[0.18em] text-rouge" style={{ textIndent: "0.18em" }} aria-label="读毕印章">读毕</span>
            <p className="text-xs opacity-60">全书 {chapters.length} 章 · 已读完</p>
            <button
              onClick={() => requireLogin(() => router.push(`/library/book/${realId}/review/new`))}
              className="mt-1 rounded-full bg-celadon px-7 py-2.5 text-sm text-snow active:scale-95"
            >
              写一篇书评
            </button>
            <button onClick={() => router.push(`/library/book/${realId}`)} className="relative text-xs opacity-60 before:absolute before:-inset-2.5 before:content-[''] active:opacity-90">回到书页</button>
          </motion.div>
        )}
      </div>

      {/* 底部工具栏：目录 / 设置 / 笔记（图标区分明显）。pb-safe：全面屏别压在 home 横条上 */}
      <AnimatePresence initial={false}>
        {chrome && (
          <motion.div
            key="botbar"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="z-20 shrink-0 border-t border-current/10 px-4 py-2 pb-safe backdrop-blur"
          >
            <div className="mb-1 text-center text-[11px] opacity-50">
              {chapterLabel(cur.no)} · 本章 {Math.round(pct)}% · 全书 {bookPct}%
            </div>
            <div className="flex items-center justify-around">
              <ToolBtn icon={<List size={18} />} label="目录" onClick={() => setToc(true)} />
              <ToolBtn icon={<StickyNote size={18} />} label="笔记" onClick={() => setNotesPanel(true)} />
              <ToolBtn icon={<Settings2 size={18} />} label="设置" onClick={() => setSettings(true)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 划线菜单 */}
      {menu && (
        <div
          ref={menuRef}
          className={"fixed z-50 w-max max-w-[96vw] -translate-x-1/2 " + (menu.below ? "" : "-translate-y-full")}
          style={{ left: menuX, top: menu.y }}
        >
          {/* B4：轻入场 + 上次用色排首位并带小勾；P2-11：色点/按钮用 before 伪元素把触区扩到 ≥40px（视觉不变） */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="flex flex-nowrap items-center gap-1.5 rounded-2xl bg-snow/95 px-2.5 py-2 text-ink shadow-xl ring-1 ring-line backdrop-blur dark:bg-dark-card/95 dark:text-dark-text dark:ring-white/10"
          >
            {[lastColor, ...HL_COLORS.filter((c) => c !== lastColor)].map((c) => (
              <button key={c} onClick={() => doHighlight(c)} aria-label={"划线·" + (HL_NAMES[HL_COLORS.indexOf(c)] ?? "标记色")} className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-black/10 transition before:absolute before:-inset-1.5 before:content-[''] active:scale-90 dark:ring-white/20" style={{ background: c }}>
                {c === lastColor && <Check size={13} className="text-ink/60" />}
              </button>
            ))}
            <span className="mx-0.5 h-5 w-px shrink-0 bg-line dark:bg-white/10" />
            <button onClick={openNote} aria-label="写笔记" className="relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-ink-700 transition before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] active:bg-moon dark:text-dark-text/85 dark:active:bg-white/10"><PenLine size={14} /> 笔记</button>
            <button onClick={copySelection} aria-label="复制" className="relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-ink-700 transition before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] active:bg-moon dark:text-dark-text/85 dark:active:bg-white/10"><Copy size={14} /> 复制</button>
          </motion.div>
        </div>
      )}

      {/* 笔记输入浮层 */}
      <AnimatePresence>
        {notePanel && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setNotePanel(null)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 pb-safe shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
              <p className="mb-2 rounded-lg border-l-[3px] px-3 py-2 text-xs text-ink-700 dark:text-dark-text/75" style={{ borderColor: notePanel.color, background: notePanel.color + "22" }}>{notePanel.excerpt}</p>
              {/* 编辑已有划线的想法时不展示色板：换色在「点击划线」浮层完成（updateNote 只更新文字） */}
              {!notePanel.editId && (
                <div className="mb-2 flex items-center gap-3">
                  <span className="text-xs text-ink-500 dark:text-dark-text/60">标记色</span>
                  {HL_COLORS.map((c, i) => (
                    <button key={c} onClick={() => setNotePanel((p) => (p ? { ...p, color: c } : p))} className={"relative h-5 w-5 rounded-full ring-2 before:absolute before:-inset-2.5 before:content-[''] " + (notePanel.color === c ? "ring-ink/40" : "ring-transparent")} style={{ background: c }} aria-label={"标记色·" + HL_NAMES[i]} />
                  ))}
                </div>
              )}
              <textarea
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onFocus={(e) => { const el = e.target; setTimeout(() => el.scrollIntoView({ block: "center" }), 300); }}
                placeholder="写下你的想法"
                className="h-24 w-full resize-none rounded-lg border border-line bg-moon p-3 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-bg dark:text-dark-text"
              />
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
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 pb-safe shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
              <p className="mb-2 rounded-lg border-l-[3px] px-3 py-2 text-sm text-ink-700 dark:text-dark-text/75" style={{ borderColor: activeNote.color, background: activeNote.color + "22" }}>{activeNote.excerpt}</p>
              {activeNote.note ? (
                <p className="text-sm text-ink dark:text-dark-text">{activeNote.note}</p>
              ) : (
                <p className="text-sm text-ink-300">这段划线还没写想法</p>
              )}
              {/* P1-2 换色：删旧 + 同位新建（保留想法） */}
              <div className="mt-3 flex items-center gap-3">
                <span className="text-xs text-ink-500 dark:text-dark-text/60">标记色</span>
                {HL_COLORS.map((c, i) => (
                  <button key={c} onClick={() => recolorNote(c)} className={"relative h-5 w-5 rounded-full ring-2 before:absolute before:-inset-2.5 before:content-[''] " + (activeNote.color === c ? "ring-ink/40" : "ring-transparent")} style={{ background: c }} aria-label={"换成" + HL_NAMES[i]} />
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={editThought}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-celadon py-2.5 text-sm text-snow active:scale-[0.99]"
                >
                  <PenLine size={15} /> {activeNote.note ? "编辑想法" : "写想法"}
                </button>
                <button
                  onClick={() => { const snap = activeNote; removeNote(snap.id); toast("已删除", "success", { label: "撤销", onClick: () => addNote(snap) }); setActiveNote(null); }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-rouge/40 py-2.5 text-sm text-rouge active:scale-[0.99]"
                >
                  <Trash2 size={15} /> 删除这条划线
                </button>
              </div>
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
                      <button onClick={() => { const snap = n; removeNote(snap.id); toast("已删除", "success", { label: "撤销", onClick: () => addNote(snap) }); }} aria-label="删除笔记" className="relative shrink-0 p-1 text-ink-300 before:absolute before:-inset-2.5 before:content-[''] active:scale-90">
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
            <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }} className="relative h-full w-[80%] max-w-[360px] overflow-y-auto bg-snow p-4 pb-safe pt-[calc(env(safe-area-inset-top)+16px)] shadow-2xl ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
              {/* 顶部「目录/书名/共N章」已去掉：读者正在读这本书，这些信息多余，直接呈现章节列表 */}
              <div className="space-y-1">
                {chapters.map((c) => {
                  const on = c.id === cur.id;
                  return (
                    <button
                      key={c.id}
                      id={on ? "toc-cur" : undefined}
                      onClick={() => { gotoChapter(c.id); setToc(false); scrollRef.current?.scrollTo(0, 0); }}
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
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="app-width relative rounded-t-[24px] bg-snow p-5 pb-safe shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5 dark:bg-dark-card dark:ring-white/10">
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
  p: ({ children }) => <p className="my-[0.9em]">{children}</p>, // 段距随字号缩放（B5）
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
function applyHighlights(root: HTMLElement, notes: NoteItem[], onClick: (n: NoteItem) => void, dark: boolean) {
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
  // 重叠区间从「整条丢弃」改为「裁剪后渲染剩余段」：历史存量/多设备并发产生的重叠划线
  // 至少在正文可见可点（原策略整条跳过 = 列表里有、正文里无的幽灵笔记）；完全被包含的才无段可渲染
  const clean: typeof ranges = [];
  let lastEnd = 0;
  for (const r of ranges) {
    const s = Math.max(r.start, lastEnd);
    if (s < r.end) { clean.push({ start: s, end: r.end, note: r.note }); lastEnd = r.end; }
  }
  clean.forEach((r) => wrapRange(root, r, onClick, dark));
}

function wrapRange(root: HTMLElement, r: { start: number; end: number; note: NoteItem }, onClick: (n: NoteItem) => void, dark: boolean) {
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
    // P2-15 深灰背景：底色透明度降到 30%（"4D"）并加标记色下划线，否则浅色高亮在深底上发灰刺眼
    mark.style.background = r.note.color + (dark ? "4D" : "80");
    mark.style.color = "inherit";
    if (r.note.note) {
      mark.style.textDecoration = "underline dotted"; // 有想法 = 点线（与浅色底一致的「有笔记」记号）
      mark.style.textDecorationColor = r.note.color;
      mark.style.textUnderlineOffset = "3px";
    } else if (dark) {
      mark.style.textDecoration = "underline";
      mark.style.textDecorationColor = r.note.color;
      mark.style.textUnderlineOffset = "3px";
    }
    const parent = target.parentNode;
    if (!parent) return;
    parent.replaceChild(mark, target);
    mark.appendChild(target);
    // stopPropagation：别让点击冒泡到正文容器触发沉浸模式 toggle（B2）
    mark.addEventListener("click", (e) => { e.stopPropagation(); onClick(r.note); });
  });
}

function ToolBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  // P2-11：min 44px 触区 + 负 margin 抵消布局影响（视觉不变）
  return (
    <button onClick={onClick} aria-label={label} className="-my-1 flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 opacity-80">
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
    <Suspense fallback={<div className="p-8 text-center text-ink-500">正在打开书页</div>}>
      <ReaderInner id={params.id} />
    </Suspense>
  );
}
