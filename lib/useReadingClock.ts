"use client";
import { useEffect, useRef } from "react";
import { useLibrary } from "@/lib/store";
import { bumpReadCount } from "@/lib/supabase/userdata";

/**
 * 阅读/收听计时：当 active 且页面可见时，按墙钟秒数累加到 useLibrary.readSeconds。
 * - 文字阅读：进入阅读器即 active。
 * - 音视频：仅在播放时 active。
 * 每累计 3 秒写一次（减少 store 写入），切后台/停止/卸载时把零头补写，尽量不丢时长。
 */
export function useReadingClock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let acc = 0;
    const flush = () => {
      if (acc > 0) {
        useLibrary.getState().addReadSeconds(acc);
        acc = 0;
      }
    };
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      acc += 1;
      if (acc >= 3) flush();
    }, 1000);
    // 切后台时立即落账，避免页面被回收导致零头丢失
    const onVis = () => { if (document.visibilityState !== "visible") flush(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      flush();
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active]);
}

/**
 * T1.5「一次阅读」计数（books.read_count，存但不展示）：
 * 同一 bookId 的 active 状态（可见时）累计满 30 秒 → 上报 +1，本次进入只报一次；
 * 换书/重新进入重新累计（同一人多次阅读多次累加，不去重；游客也计入）。
 */
export function useReadCountBump(bookId: string | undefined, active: boolean) {
  const acc = useRef(0);
  const bumped = useRef(false);
  // 换书重置（同一组件实例内 bookId 变化，如乱翻滑动切书）
  useEffect(() => {
    acc.current = 0;
    bumped.current = false;
  }, [bookId]);
  useEffect(() => {
    if (!active || !bookId || bumped.current) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (bumped.current) return;
      acc.current += 1;
      if (acc.current >= 30) {
        bumped.current = true;
        bumpReadCount(bookId);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [active, bookId]);
}
