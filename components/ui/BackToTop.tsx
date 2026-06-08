"use client";
import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * 回到顶部浮动按钮：仅当页面向下滚动「超过一屏（第二页之后）」才出现。
 * 列表不足一屏时根本无法滚动 → 按钮永不出现，符合预期。
 */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  if (!show) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="回到顶部"
      className="fixed bottom-24 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-snow/90 text-ink-500 shadow-lg backdrop-blur transition active:scale-90 dark:border-white/10 dark:bg-dark-card/90 dark:text-dark-text/70"
    >
      <ArrowUp size={18} />
    </button>
  );
}
