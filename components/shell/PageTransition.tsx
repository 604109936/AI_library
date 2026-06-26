"use client";

/** 列表错位淡入容器/子项的预设 variants（stagger 60ms）。 */
export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
export const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.4, 0, 0.2, 1] } },
};
