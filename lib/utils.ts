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
  // 按日历日差判断（零点对齐），避免「昨晚 8 点」距今不足 24h 被误判成今天
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return WEEKDAYS[d.getDay()];
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

/** 章节展示名：no=0 视为「前言」(第一章之前的单独一章)，否则「第N章」(可带标题)。 */
export function chapterLabel(no: number, title = ""): string {
  if (no === 0) return "前言";
  return `第${no}章${title ? " " + title : ""}`;
}

/**
 * 生成 uuid v4，兼容**非安全上下文**（手机经局域网 IP 的 HTTP 访问）。
 * crypto.randomUUID() 仅在安全上下文(HTTPS/localhost)可用，HTTP 下不存在；
 * 故优先用它，否则回退到 getRandomValues，再不行用 Math.random。
 */
export function uid(): string {
  const c: Crypto | undefined = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
