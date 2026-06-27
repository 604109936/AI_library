"use client";
import { useUI } from "@/lib/store";
import { AnimatePresence, motion } from "framer-motion";

/**
 * 轻提示：屏幕居中浮现（不再置顶），无图标、纯文案的精致小卡片；
 * 出现时附一层淡蒙层聚焦视线，但 pointer-events-none 不阻挡操作。
 */
export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex -translate-y-[60px] flex-col items-center justify-center gap-2 px-8">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 460, damping: 28 }}
            className="pointer-events-auto relative max-w-app rounded-2xl bg-ink/75 px-6 py-3.5 text-center text-[15px] font-medium leading-snug text-snow shadow-[0_12px_36px_rgba(0,0,0,0.34)] ring-1 ring-white/15 backdrop-blur-md dark:bg-dark-card/75"
          >
            <span>{t.msg}</span>
            {t.action && (
              <button
                onClick={() => { t.action!.onClick(); useUI.getState().dismiss(t.id); }}
                className="mt-2.5 block w-full rounded-full border border-white/25 px-3 py-1 text-xs text-celadon-300 active:scale-95"
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
