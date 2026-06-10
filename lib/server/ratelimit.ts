// 简易滑动窗口限流（T5 上线加固）：智学对话直连 MiniMax 烧 token，必须有闸。
// serverless 下是「单实例内存级、尽力而为」——多实例并发时上限会放宽数倍，
// 但足以挡住单点脚本滥刷；要做严格全局限流需引入 Redis/Upstash（上线后视滥用情况再升级）。
import "server-only";

const buckets = new Map<string, number[]>();
const SWEEP_AT = 5000; // 键数超过此值时全量清扫过期记录，防内存膨胀

// 返回 true=放行；false=超限
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > SWEEP_AT) {
    buckets.forEach((arr, k) => {
      const live = arr.filter((t) => now - t < windowMs);
      if (live.length) buckets.set(k, live);
      else buckets.delete(k);
    });
  }
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// 取请求方标识：登录用 uid（精确），游客用 IP（Vercel 的 x-forwarded-for 首段）
export function limiterKey(uid: string | null, fwd: string | null): string {
  return uid ?? `ip:${(fwd ?? "unknown").split(",")[0].trim()}`;
}
