"use client";

/** 列表淡入容器/子项：仅淡入、不上移、不错位延迟——切 Tab 重挂载时列表直接整齐就位，杜绝逐个上滑的抖动。 */
export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0 } },
};
export const staggerItem = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } },
};
