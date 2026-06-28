// 滑动窗口限流（T5 上线加固，T9 放宽阈值）：智学对话直连 MiniMax 烧 token，必须有闸。
// 默认「单实例内存级、尽力而为」——多实例并发时全局上限会放宽数倍，但足以挡住单点脚本滥刷。
// 配置了 Vercel KV / Upstash（环境变量 KV_REST_API_URL + KV_REST_API_TOKEN）时自动启用共享存储做「全局」
// 固定窗口计数，多实例下也能严格限流；KV 不可用/故障一律降级放行，绝不因限流基建抖动误挡正常用户（Bug#16）。
import "server-only";

// 桶里记录各自的窗口期：分钟桶与小时桶混存一个 Map，清扫按各桶自身 win 过滤
const buckets = new Map<string, { win: number; ts: number[] }>();
const SWEEP_AT = 5000; // 键数超过此值时全量清扫过期记录，防内存膨胀
const SWEEP_GAP = 30_000; // 清扫节流：超阈值后若每个请求都全表扫描，大量游客 IP 场景下是 O(N) CPU 放大
const HARD_MAX = 20_000; // 键数硬上限：清扫后仍超出按最旧插入淘汰（被淘汰键的限流略放宽，尽力而为口径）
let lastSweep = 0;

// 单实例内存级（同步）：返回 true=放行；false=超限
function rateLimitMemory(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > SWEEP_AT && now - lastSweep > SWEEP_GAP) {
    lastSweep = now;
    buckets.forEach((b, k) => {
      const live = b.ts.filter((t) => now - t < b.win);
      if (live.length) b.ts = live;
      else buckets.delete(k);
    });
    if (buckets.size > HARD_MAX) {
      let drop = buckets.size - HARD_MAX;
      buckets.forEach((_, k) => { if (drop-- > 0) buckets.delete(k); }); // Map 迭代序=插入序，删的是最旧键
    }
  }
  const b = buckets.get(key) ?? { win: windowMs, ts: [] };
  b.ts = b.ts.filter((t) => now - t < windowMs);
  if (b.ts.length >= max) {
    buckets.set(key, b);
    return false;
  }
  b.ts.push(now);
  buckets.set(key, b);
  return true;
}

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const kvEnabled = !!(KV_URL && KV_TOKEN);

// Vercel KV / Upstash REST：固定窗口原子自增 + 过期，给计费路径做全局兜底（滑窗可后续用 ZSET 升级）。
// 任意环节失败一律返回放行：限流是防滥用闸，不该因其基建抖动把正常用户挡在门外。
async function rateLimitKV(key: string, max: number, windowMs: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / windowMs);
  const k = `rl:${key}:${windowMs}:${bucket}`;
  try {
    const r = await fetch(`${KV_URL}/incr/${encodeURIComponent(k)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    if (!r.ok) return true; // KV 故障降级放行
    const j = await r.json().catch(() => null);
    const count = Number(j?.result) || 0;
    // 首次计数即设过期（窗口长度 + 1s 余量），让旧桶自动回收
    if (count === 1) {
      await fetch(`${KV_URL}/pexpire/${encodeURIComponent(k)}/${windowMs + 1000}`, {
        method: "POST",
        headers: { authorization: `Bearer ${KV_TOKEN}` },
        cache: "no-store",
      }).catch(() => {});
    }
    return count <= max;
  } catch {
    return true; // 网络异常降级放行（内存层仍在挡单点滥刷）
  }
}

// 返回 true=放行；false=超限。先过内存层（cheap，挡单实例突发），再过 KV 全局层（若启用）。
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (!rateLimitMemory(key, max, windowMs)) return false; // 本实例已超限：省一次 KV 往返
  if (kvEnabled) return rateLimitKV(key, max, windowMs);
  return true;
}

// 取请求方标识：登录用 uid（精确），游客用 IP（Vercel 的 x-forwarded-for 首段）
export function limiterKey(uid: string | null, fwd: string | null): string {
  return uid ?? `ip:${(fwd ?? "unknown").split(",")[0].trim()}`;
}

// 可信客户端 IP：Vercel 把真实客户端 IP 放在 x-real-ip / x-vercel-forwarded-for；
// x-forwarded-for 的【最左】段是客户端自填、可任意伪造的部分（攻击者每次换首段即可绕过按 IP 限流）。
// 故优先取前两者，仅在缺失时回落 XFF 的【最右】一段兜底。用于 /api/demo 等"按 IP 防滥用"的敏感入口。
export function clientIp(h: Headers): string {
  const real = h.get("x-real-ip") || h.get("x-vercel-forwarded-for");
  if (real) return real.split(",")[0].trim();
  const xff = h.get("x-forwarded-for");
  if (xff) { const p = xff.split(","); return p[p.length - 1].trim(); }
  return "unknown";
}
