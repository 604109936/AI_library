"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { getBook } from "@/lib/api";
import { BookCover } from "@/components/ui/BookCover";
import { StarPicker } from "@/components/ui/Stars";
import { Motif } from "@/components/ui/Motif";
import { useAuth, useLibrary, useUI } from "@/lib/store";

const MAX = 2000;
// 星级伴随文案（1-5 星；半星向上取整取同档）
const RATE_TEXT = ["失望", "一般", "还行", "推荐", "力荐"];

// 门禁外壳：必须等登录态与「我的数据」都加载完成再初始化表单。
// 否则直刷本页时 myReviews 还是空，表单以空内容定格，用户一提交就把云端原书评整条洗掉（Review P1）。
export default function ReviewEditor({ params }: { params: { id: string } }) {
  const authHydrated = useAuth((s) => s.hydrated);
  const libHydrated = useLibrary((s) => s.hydrated);
  if (!authHydrated || !libHydrated) {
    return <main className="flex min-h-[100dvh] items-center justify-center text-sm text-ink-300">正在打开</main>;
  }
  return <ReviewForm id={params.id} />;
}

function ReviewForm({ id }: { id: string }) {
  const real = id.split("__")[0];
  const router = useRouter();
  const openLogin = useUI((s) => s.openLogin);
  const toast = useUI((s) => s.toast);
  const upsertReview = useLibrary((s) => s.upsertReview);
  const myReviews = useLibrary((s) => s.myReviews);
  const { data: book } = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id) });

  // 该书我的既有书评（有则进入「更新」模式，预填内容）
  const existing = myReviews.find((r) => r.bookId === real);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  // 提交锁：ref 同步防双击连发（双击 = upsert 两次 + router.back 两次连退两层），state 驱动按钮 UI
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  // 离开确认：与初始值比对判断「有未保存改动」
  const [leaveOpen, setLeaveOpen] = useState(false);
  const initial = useRef({ rating: existing?.rating ?? 0, title: existing?.title ?? "", content: existing?.content ?? "" });
  const dirty = rating !== initial.current.rating || title !== initial.current.title || content !== initial.current.content;
  // 深链直开（分享链接/新标签）时 history 栈长 1，router.back() 无处可退会定格在表单页：兜底回详情页
  const goBack = () => { if (window.history.length > 1) router.back(); else router.replace(`/library/book/${real}`); };

  const isEdit = !!existing;
  const canPublish = rating > 0 && content.trim().length >= 10;
  const needWords = content.trim().length < 10 ? 10 - content.trim().length : 0;

  function doPublish() {
    if (submitLock.current) return;
    const u = useAuth.getState().user;
    if (!u || !book || !canPublish) return;
    submitLock.current = true;
    setSubmitting(true);
    upsertReview({
      id: existing?.id ?? "mr" + Date.now(),
      bookId: real,
      bookTitle: book.title,
      bookCoverSeed: book.coverSeed,
      bookCover: book.cover,
      userId: "me",
      nickname: u.nickname,
      avatarSeed: u.avatarSeed,
      avatarUrl: u.avatarUrl,
      rating,
      title: title.trim() || undefined,
      content: content.trim(),
      likes: existing?.likes ?? 0,
      createdAt: existing?.createdAt ?? new Date().toISOString(), // 编辑时保留原发表时间，避免排序/日期错乱
      mine: true,
    });
    toast(isEdit ? "书评已更新" : "书评已发布");
    goBack();
  }
  function publish() {
    if (submitLock.current) return;
    if (!useAuth.getState().user) {
      openLogin(doPublish); // 未登录：登录成功后由 pending 回调执行
      return;
    }
    doPublish();
  }
  // 返回：有未保存改动先弹确认；发布跳转中忽略
  function onBack() {
    if (submitLock.current) return;
    if (dirty) {
      setLeaveOpen(true);
      return;
    }
    goBack();
  }

  const nearLimit = content.length > MAX * 0.9;

  return (
    <main className="relative min-h-[100dvh]">
      <Motif name="mountain" className="pointer-events-none absolute right-0 top-12 h-16 w-40 text-celadon/25" />
      <header className="sticky top-0 z-30 flex h-14 items-center bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={onBack} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
        </button>
        <h1 className="flex-1 text-center font-serif text-lg text-ink dark:text-dark-text">{isEdit ? "更新书评" : "写书评"}</h1>
        <button
          onClick={publish}
          disabled={!canPublish || submitting}
          className="rounded-full bg-celadon px-4 py-1.5 text-sm text-snow disabled:opacity-40"
        >
          {submitting ? "发布中" : isEdit ? "更新" : "发布"}
        </button>
      </header>

      <div className="relative space-y-5 p-4">
        {book && (
          <div className="flex flex-col items-center gap-2 pt-1 text-center">
            <BookCover title={book.title} seed={book.coverSeed} src={book.cover} className="w-14" showText={false} />
            <div>
              <p className="font-serif text-base text-ink dark:text-dark-text">{book.title}</p>
              <p className="mt-0.5 text-xs text-ink-300">{book.author}</p>
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-1.5 py-2">
          <StarPicker value={rating} onChange={setRating} />
          {rating > 0 ? (
            <span className="text-xs font-medium text-rouge">{RATE_TEXT[Math.min(5, Math.ceil(rating)) - 1]}</span>
          ) : (
            <span className="text-xs text-ink-300">轻点星星打个分</span>
          )}
          {rating > 0 && needWords > 0 && <span className="text-xs text-ink-300">再写 {needWords} 字就能发布</span>}
        </div>

        <div className="relative">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 30))}
            placeholder="给你的书评起个标题（选填）"
            className="w-full rounded-2xl border border-line bg-snow px-3.5 py-3 pr-14 text-sm text-ink outline-none focus:border-celadon dark:border-white/10 dark:bg-dark-card dark:text-dark-text"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-300">{title.length}/30</span>
        </div>

        <div className="rounded-2xl border border-line bg-snow p-3 focus-within:border-celadon dark:border-white/10 dark:bg-dark-card">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value.slice(0, MAX))}
            placeholder="写下你的想法（至少 10 字）"
            className="h-44 w-full resize-none bg-transparent text-sm text-ink outline-none dark:text-dark-text"
          />
          <div className={"text-right text-[11px] " + (nearLimit ? "text-rouge" : "text-ink-300")}>{content.length}/{MAX}</div>
        </div>
      </div>

      {/* 未保存改动 · 离开确认（底部弹层，与全站删除确认同款样式） */}
      <AnimatePresence>
        {leaveOpen && (
          <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setLeaveOpen(false)} />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="app-width relative rounded-t-[24px] bg-snow p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] dark:bg-dark-card"
            >
              <p className="text-center text-sm text-ink dark:text-dark-text">书评尚未发布，确定离开？</p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => setLeaveOpen(false)} className="flex-1 rounded-2xl bg-moon py-3 text-sm text-ink-700 dark:bg-dark-bg dark:text-dark-text/80">留下</button>
                <button onClick={goBack} className="flex-1 rounded-2xl bg-celadon py-3 text-sm text-snow">离开</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
