"use client";
import { useEffect } from "react";
import { useLibrary } from "@/lib/store";

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
