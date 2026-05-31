"use client";
import { useUI } from "@/lib/store";
import { Check, X, Info } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  return (
    <div
      className="fixed left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none"
      style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            aria-live={t.type === "error" ? "assertive" : "polite"}
            onClick={() => dismiss(t.id)}
            initial={{ opacity: 0, y: -18, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 480, damping: 26 }}
            className="pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-2xl bg-ink/95 py-2.5 pl-2.5 pr-4 text-sm font-medium text-snow shadow-2xl ring-1 ring-white/10 backdrop-blur-md max-w-app dark:bg-dark-card/95"
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-snow shadow-sm",
                t.type === "success" ? "bg-celadon" : t.type === "error" ? "bg-rouge" : "bg-brass"
              )}
            >
              {t.type === "success" ? <Check size={16} strokeWidth={2.6} /> : t.type === "error" ? <X size={16} strokeWidth={2.6} /> : <Info size={16} strokeWidth={2.6} />}
            </span>
            <span className="leading-snug">{t.msg}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
