"use client";

/**
 * 文字水波纹（shimmer 扫光）：一道柔和光泽周期性扫过文字，传达「正在进行中」——
 * 替代省略号/跳点/转圈等廉价等待表达（T8）。
 *
 * 实现要点（60fps 硬要求，仅用可合成属性）：
 *   双层文字 + 滑动窗口。基底层是淡墨色全文；上面盖一个 overflow:hidden 的窄窗口，
 *   窗口内放同一份文字（高光青瓷色）。窗口用 transform:translateX 从左扫到右，
 *   窗口内文字以精确反比例同步反向位移（窗口宽 36% 容器 → 文字补偿 = -0.36×窗口位移），
 *   两个 transform 合成后文字在视觉上纹丝不动，只有「高光窗」掠过——
 *   全程零 paint/layout，纯 compositor 动画。动画定义见 globals.css 的 .shimmer-*。
 */
export function ShimmerText({ text }: { text: string }) {
  return (
    <span className="relative inline-block whitespace-nowrap align-bottom">
      <span className="text-ink-300 dark:text-dark-text/45">{text}</span>
      <span aria-hidden className="shimmer-win pointer-events-none absolute inset-y-0 left-0 w-[36%] overflow-hidden">
        <span className="shimmer-win-text inline-block whitespace-nowrap text-celadon-700 dark:text-celadon-300">{text}</span>
      </span>
    </span>
  );
}
