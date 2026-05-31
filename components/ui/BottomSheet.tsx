"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** 统一底部抽屉：背景遮罩 + 滚动锁定 + ESC 关闭 + role=dialog/aria-modal + 焦点移入 + 底部安全区。
 *  替代各页重复手写的弹层样板（登录 / 退出确认 / 头像选择 / 离开确认等）。 */
export function BottomSheet({
  open,
  onClose,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // 锁定背后页面滚动，防穿透
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => panelRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className={cn(
              "app-width pb-sheet relative rounded-t-2xl bg-snow px-6 pt-3 outline-none dark:bg-dark-card",
              className
            )}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line dark:bg-white/15" />
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
