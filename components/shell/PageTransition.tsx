"use client";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

/** 全局页面进入动效：淡入 + 8px 上移（遵循设计规范）。
 *  包裹页面内容容器，避免包住 fixed 的底栏/浮层。 */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** 列表错位淡入容器/子项的预设 variants（stagger 60ms）。 */
export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
export const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.4, 0, 0.2, 1] } },
};
