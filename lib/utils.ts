import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCount(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "千";
  return String(n);
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 列表相对日期：今天 / 昨天 / 周X（本周内）/ M月D日（更早） */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day && now.getDate() === d.getDate()) return "今天";
  if (diff < 2 * day) return "昨天";
  if (diff < 7 * day) return WEEKDAYS[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 对话历史时间：今天 HH:mm / 昨天 HH:mm / 周X / 上周 / M月D日 */
export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (diff < day && now.getDate() === d.getDate()) return `今天 ${hm}`;
  if (diff < 2 * day) return `昨天 ${hm}`;
  if (diff < 7 * day) return WEEKDAYS[d.getDay()];
  if (diff < 14 * day) return "上周";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
