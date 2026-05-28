"use client";
import { useUI } from "@/lib/store";
import { Check, X, Info } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="fixed top-3 left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink/92 text-snow px-4 py-2.5 text-sm shadow-lg backdrop-blur max-w-app"
          >
            <span
              className={
                t.type === "success"
                  ? "text-celadon-300"
                  : t.type === "error"
                  ? "text-rouge"
                  : "text-brass"
              }
            >
              {t.type === "success" ? <Check size={16} /> : t.type === "error" ? <X size={16} /> : <Info size={16} />}
            </span>
            <span className="leading-none">{t.msg}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
