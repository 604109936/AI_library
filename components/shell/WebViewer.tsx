"use client";
// 站内浏览浮层（In-App Browser）：点来源资料不再跳出 App——聊天页在浮层底下原封不动（流式继续、位置不丢），
// 关闭即回原地。借鉴"切 Tab 不断流"的本质：始终不离开 SPA。部分网站禁内嵌(X-Frame-Options)，顶栏常备「浏览器打开」降级。
import { useEffect, useState, useSyncExternalStore } from "react";
import { X, ExternalLink, Globe } from "lucide-react";

let current: { url: string; host: string; key: number } | null = null;
const subs = new Set<() => void>();
let seq = 0;
export function openWebViewer(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    current = { url, host: u.hostname.replace(/^www\./, ""), key: ++seq };
  } catch { return; }
  // 压入一条历史记录：侧滑返回/返回键只消费这一条＝关闭浮层留在原页（否则会退到上一个路由如泡馆）
  try { window.history.pushState({ __webviewer: seq }, ""); } catch {}
  subs.forEach((cb) => cb());
}
function dismiss() { if (!current) return; current = null; subs.forEach((cb) => cb()); }
function closeViewer() {
  if (!current) return;
  // 主动关闭（点✕）：回退一步消费掉 open 时压入的历史，popstate 里 dismiss；历史异常时直接关兜底
  try { window.history.back(); } catch { dismiss(); }
  setTimeout(() => { if (current) dismiss(); }, 120); // back 未触发 popstate 的极端兜底
}

export function WebViewer() {
  const snap = useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => current,
    () => null
  );
  const [loaded, setLoaded] = useState(0); // 按 key 记录已加载，切换新链接时重置提示
  // 侧滑返回/返回键：关浮层、不换路由（URL 未变，Next 路由不动）
  useEffect(() => {
    const onPop = () => dismiss();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  if (!snap) return null;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-snow dark:bg-dark-bg">
      {/* 顶栏：关闭 + 域名 + 浏览器打开（内嵌被禁时的永久逃生口） */}
      <div className="flex items-center gap-2 border-b border-line px-3 pb-2 pt-[calc(env(safe-area-inset-top)+8px)] dark:border-white/10">
        <button onClick={closeViewer} aria-label="关闭" className="flex h-9 w-9 items-center justify-center rounded-full active:bg-moon/60 dark:active:bg-white/10">
          <X size={20} className="text-ink dark:text-dark-text" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Globe size={13} className="shrink-0 text-celadon" />
          <span className="truncate text-sm text-ink-700 dark:text-dark-text/80">{snap.host}</span>
        </div>
        <a href={snap.url} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-ink-500 active:bg-moon/60 dark:border-white/15 dark:text-dark-text/70">
          浏览器打开 <ExternalLink size={12} />
        </a>
      </div>
      {/* 网页本体：key 换链接强制重建；加载前显示提示（含被禁内嵌时的引导） */}
      <div className="relative flex-1">
        {loaded !== snap.key && (
          <div className="pointer-events-none absolute inset-x-0 top-16 flex flex-col items-center gap-2 px-8 text-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-celadon" />
            <p className="text-xs text-ink-300 dark:text-dark-text/50">加载中…若一直空白，说明该网站不支持站内预览，点右上角「浏览器打开」</p>
          </div>
        )}
        <iframe
          key={snap.key}
          src={snap.url}
          onLoad={() => setLoaded(snap.key)}
          className="relative h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
