"use client";
import { useEffect } from "react";

// 多弹层嵌套用计数：首个上锁时记下原值，最后一个解锁时恢复，避免内层关闭误开外层的锁
let lockCount = 0;
let prevScrollY = 0;
let prev: { position: string; top: string; left: string; right: string; width: string; overflow: string } | null = null;

/**
 * 弹层打开时锁定背景页面滚动，关闭自动恢复。
 * iOS Safari / 微信 WebView 对 body overflow:hidden 不生效（触摸滚动直接作用于文档），
 * 必须用 position:fixed + top:-scrollY 方案钉住页面，解锁时恢复滚动位置。
 */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const body = document.body;
    if (lockCount === 0) {
      prevScrollY = window.scrollY;
      const s = body.style;
      prev = { position: s.position, top: s.top, left: s.left, right: s.right, width: s.width, overflow: s.overflow };
      s.position = "fixed";
      s.top = `-${prevScrollY}px`;
      s.left = "0";
      s.right = "0";
      s.width = "100%";
      s.overflow = "hidden"; // 桌面端兜底
    }
    lockCount++;
    return () => {
      lockCount--;
      if (lockCount === 0 && prev) {
        const s = document.body.style;
        s.position = prev.position;
        s.top = prev.top;
        s.left = prev.left;
        s.right = prev.right;
        s.width = prev.width;
        s.overflow = prev.overflow;
        prev = null;
        window.scrollTo(0, prevScrollY); // 解除 fixed 后回到原滚动位置
      }
    };
  }, [locked]);
}
