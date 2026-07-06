"use client";
// 站内浏览浮层（完全无 UI 版）：点来源资料不跳出 App——聊天页在底下继续流式、位置不丢；
// 成功内嵌＝全屏纯网页零遮挡（用户无感）；关闭靠侧滑返回/返回键（open 时压入历史，popstate 消费）。
// 被禁内嵌（服务端预检确认）→ 友好落地态给「用浏览器打开」；预检不确定且 6s 未加载完 → 浮出兜底小按钮。
import { useEffect, useState, useSyncExternalStore } from "react";
import { ExternalLink, Globe } from "lucide-react";

let current: { url: string; host: string; key: number } | null = null;
const subs = new Set<() => void>();
let seq = 0;
export function openWebViewer(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    current = { url, host: u.hostname.replace(/^www\./, ""), key: ++seq };
  } catch { return; }
  // 压入一条历史：侧滑返回/返回键只消费这一条＝关浮层留在原页（不会退到上一个路由）
  try { window.history.pushState({ __webviewer: seq }, ""); } catch {}
  subs.forEach((cb) => cb());
}
function dismiss() { if (!current) return; current = null; subs.forEach((cb) => cb()); }
function closeViewer() {
  if (!current) return;
  try { window.history.back(); } catch { dismiss(); }
  setTimeout(() => { if (current) dismiss(); }, 120);
}

export function WebViewer() {
  const snap = useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => current,
    () => null
  );
  const [loadedKey, setLoadedKey] = useState(0);
  const [blockedKey, setBlockedKey] = useState(0); // 预检确认被禁内嵌的 key
  const [slowKey, setSlowKey] = useState(0); // 6s 未加载完成的 key（兜底按钮）
  // 侧滑返回/返回键：关浮层、不换路由
  useEffect(() => {
    const onPop = () => dismiss();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // 打开即后台预检 + 起 6s 兜底计时
  useEffect(() => {
    if (!snap) return;
    const k = snap.key;
    fetch(`/api/embed-check?url=${encodeURIComponent(snap.url)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (current?.key === k && j?.checked && j.embeddable === false) setBlockedKey(k); })
      .catch(() => {});
    const t = setTimeout(() => { if (current?.key === k) setSlowKey(k); }, 6000);
    return () => clearTimeout(t);
  }, [snap]);
  if (!snap) return null;
  const loaded = loadedKey === snap.key;
  const blocked = blockedKey === snap.key;
  const slow = slowKey === snap.key && !loaded;
  return (
    <div className="fixed inset-0 z-[80] bg-snow dark:bg-dark-bg">
      {blocked ? (
        // 落地态（我们自己的页面）：明确告知 + 两个出口
        <div className="flex h-full flex-col items-center justify-center gap-4 px-10 text-center">
          <Globe size={40} className="text-celadon/50" />
          <p className="text-sm text-ink-700 dark:text-dark-text/80">该网站不支持站内预览</p>
          <a href={snap.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-full bg-celadon px-6 py-2.5 text-sm text-snow active:scale-95">
            用浏览器打开 <ExternalLink size={14} />
          </a>
          <button onClick={closeViewer} className="text-xs text-ink-300 underline underline-offset-4 dark:text-dark-text/50">返回聊天</button>
        </div>
      ) : (
        <>
          {!loaded && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-celadon" />
            </div>
          )}
          <iframe
            key={snap.key}
            src={snap.url}
            onLoad={() => setLoadedKey(snap.key)}
            className="relative h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer"
          />
          {/* 兜底：预检不确定 + 6s 仍未加载完成（疑似白屏）才浮出出口，成功场景全程无感 */}
          {slow && (
            <div className="absolute inset-x-0 bottom-8 flex justify-center">
              <a href={snap.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-full bg-black/55 px-5 py-2.5 text-xs text-white backdrop-blur-md active:scale-95">
                打不开？用浏览器打开 <ExternalLink size={13} />
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
