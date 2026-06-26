"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Search as SearchIcon, X, Flame } from "lucide-react";
import { BookRow } from "@/components/library/BookCard";
import { Skeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { search, getHotSearches, logSearch } from "@/lib/api";
import { useUI } from "@/lib/store";

function SearchInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [input, setInput] = useState(() => sp.get("q") ?? "");
  const [q, setQ] = useState(() => (sp.get("q") ?? "").trim());
  const [autoFocusInit] = useState(() => !sp.get("q")); // 从详情页返回(URL 带 ?q)时不再自动弹键盘
  const hydrated = useUI((s) => s.hydrated);
  const recent = useUI((s) => s.recentSearches);
  const addRecent = useUI((s) => s.addRecent);
  const removeRecent = useUI((s) => s.removeRecent);
  const clearRecent = useUI((s) => s.clearRecent);

  // 防抖
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  // 查询词同步进 URL：使「搜词 → 点进一本看不合适 → 返回继续挑」能还原查询词与结果列表，不必每次重打
  // （App Router 软导航返回时本页重挂载，从 ?q= 恢复 input/q，TanStack Query 命中缓存即时回显）（Bug#10）
  useEffect(() => {
    const cur = sp.get("q") ?? "";
    if (q !== cur) router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { scroll: false });
    // eslint-disable-next-line
  }, [q]);

  const { data, isLoading, isError, isFetching, refetch, isPlaceholderData } = useQuery({
    queryKey: ["search", q],
    queryFn: () => search(q),
    enabled: q.length > 0,
    placeholderData: (p) => p, // 换词时沿用旧结果渲染，不闪骨架
  });
  // 热门搜索：真实书目动态生成（点出去必有结果；T3.4 换 search_logs 聚合）
  const hotQ = useQuery({ queryKey: ["hotSearches"], queryFn: getHotSearches, staleTime: 10 * 60 * 1000 });
  const hotSearches = hotQ.data ?? [];

  const hasResult = !!data && data.books.length > 0;

  // 仅“有结果”时写入历史（提交/点击只切换 q，由此 effect 统一记录，避免零结果词污染最近搜索）。
  // 必须排除 placeholder 态：换词瞬间 data 还是旧词的结果，不排除会把"旧词有结果"当成"新词有结果"，
  // 零结果新词照样进最近搜索、慢请求时还误报 search_logs。
  // search_logs 上报延后 1.2s：连续输入的中间态前缀词（打“认知觉醒”停顿出的“认”）会被 q 变化取消，
  // 不污染热门聚合；停下来真正看结果的词才算一次有效搜索
  useEffect(() => {
    if (!(q && hasResult) || isPlaceholderData) return;
    // addRecent 与 logSearch 共用 1.2s 延迟：打"认知觉醒"中途停顿出的前缀词"认知"若即时写入，
    // 5 条容量的「最近搜过」很快被中间态挤满；继续输入即取消，停下来真正看结果的词才记录
    const t = setTimeout(() => { addRecent(q); logSearch(q); }, 1200);
    return () => clearTimeout(t);
  }, [q, hasResult, isPlaceholderData, addRecent]);

  function submit(term: string) {
    setInput(term);
    setQ(term.trim()); // 跳过防抖，立即进入结果态；是否写历史交由上面的 effect 判断
  }

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/library");
  }

  return (
    <main className="min-h-[100dvh]">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-moon/90 px-2 backdrop-blur dark:bg-dark-bg/90">
        <button onClick={goBack} aria-label="返回" className="flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft size={24} className="text-ink dark:text-dark-text" />
        </button>
        <form onSubmit={(e) => { e.preventDefault(); submit(input); }} className="flex flex-1 items-center gap-2 rounded-full border border-line bg-snow px-3.5 py-2 dark:border-white/10 dark:bg-dark-card">
          <SearchIcon size={16} className="text-ink-300" />
          <input
            autoFocus={autoFocusInit}
            type="search"
            enterKeyHint="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜索书名 / 作者 / 标签"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-300 dark:text-dark-text [&::-webkit-search-cancel-button]:appearance-none"
          />
          {q.length > 0 && isFetching && <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-celadon dark:border-white/15 dark:border-t-celadon" />}
          {input && <button type="button" aria-label="清除" onClick={() => setInput("")} className="-m-3.5 p-3.5"><X size={16} className="text-ink-300" /></button>}
        </form>
        <button onClick={goBack} className="px-2 text-sm text-ink-500 dark:text-dark-text/60">取消</button>
      </header>

      <div className="p-4">
        {!q ? (
          <div className="space-y-6">
            {hydrated && recent.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm text-ink dark:text-dark-text">最近搜过</h2>
                  <button onClick={clearRecent} className="text-xs text-ink-300">清空</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded-full bg-snow px-3 py-1.5 text-xs text-ink-700 dark:bg-dark-card dark:text-dark-text">
                      <button onClick={() => submit(t)}>{t}</button>
                      {/* 触区只向右/上下外扩：向左外扩会压住词条末字（后绘者赢命中，点词尾变成误删） */}
                      <button aria-label="移除" onClick={() => removeRecent(t)} className="-my-3.5 -mr-3.5 py-3.5 pr-3.5 pl-1">
                        <X size={12} className="text-ink-300" />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            )}
            {hotSearches.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1 text-sm text-ink dark:text-dark-text"><Flame size={14} className="text-rouge" /> 热门搜索</h2>
                <div className="flex flex-wrap gap-2">
                  {hotSearches.map((t) => (
                    <button key={t} onClick={() => submit(t)} className="rounded-full bg-celadon-soft px-3 py-1.5 text-xs text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300">
                      {t}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : !hasResult ? (
          <EmptyState icon="search" title="没有找到相关书籍" subtitle="换个书名 / 作者 / 标签试试" />
        ) : (
          // 换词请求中：旧结果降透明度过渡，避免骨架闪烁
          <section className={"transition-opacity duration-200 " + (isFetching ? "opacity-60" : "opacity-100")}>
            <h2 className="mb-2 text-sm text-ink dark:text-dark-text">书籍</h2>
            <div className="space-y-3">
              {data!.books.map((b) => <BookRow key={b.id} book={b} />)}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-ink-500">正在打开</div>}>
      <SearchInner />
    </Suspense>
  );
}
