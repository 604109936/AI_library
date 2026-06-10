"use client";
import { useEffect } from "react";

// 多弹层嵌套用计数：首个上锁时记下原值，最后一个解锁时恢复，避免内层关闭误开外层的锁
let lockCount = 0;
let prevOverflow = "";

/** 弹层打开时锁定背景页面滚动（body overflow:hidden），关闭自动恢复 */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    if (lockCount === 0) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount++;
    return () => {
      lockCount--;
      if (lockCount === 0) document.body.style.overflow = prevOverflow;
    };
  }, [locked]);
}
