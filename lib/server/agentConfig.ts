// Agent 在线调试配置「覆盖层」：后台保存的提示词/工具描述/参数存这份 JSON；运行时合并到硬编码默认上。
// 设计：原 agent.ts / tools.ts 里的硬编码值仍是「出厂默认」；本文件只管「覆盖」的读写——
//   - 有覆盖就用覆盖、没有就用默认（后台清空某项即回退默认）；
//   - 读带 1s 微缓存（改完≤1s 全局生效，足够"实时"且不每请求都读盘）。
// 仅本地 dev 可写（Vercel 文件系统只读）：与你选定的「保存=改代码数据、暂只本地生效」一致。
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface AgentOverride {
  systemInstructions?: string; // 系统指令块（不含运行时注入的书单/读者/记忆数据段）
  toolDescriptions?: Record<string, string>; // 工具名 → 描述
  model?: string;
  temperature?: number;
  // 对话摘要（compress）：触发阈值 + 温度 + 压缩指令
  compressKeep?: number; // 保留最近多少条不压（KEEP，默认 40＝最近 20 轮）
  compressBatchMin?: number; // 超出保留区再攒够多少条才压一次（BATCH_MIN，默认 8）
  compressTemperature?: number; // 默认 0.3
  compressPrompt?: string; // 压缩器系统指令
  // 长期记忆（memory）：触发阈值 + 温度 + 记忆指令
  memoryMinNew?: number; // 攒够多少条新消息才更新一次（MIN_NEW，默认 4＝约 2 轮）
  memoryTemperature?: number; // 默认 0.2
  memoryPrompt?: string; // 记忆管理器系统指令
}

// 出厂默认（与 minimax MODEL / route 主轮温度一致）：用于后台「恢复默认」与「与默认相同则不存覆盖」
export const DEFAULT_MODEL = "MiniMax-M3";
export const DEFAULT_TEMPERATURE = 0.7;
// 对话摘要 / 长期记忆 的出厂阈值与温度（与 compress.ts / memory.ts 原硬编码一致）
export const DEFAULT_COMPRESS_KEEP = 40;
export const DEFAULT_COMPRESS_BATCH_MIN = 8;
export const DEFAULT_COMPRESS_TEMPERATURE = 0.3;
export const DEFAULT_MEMORY_MIN_NEW = 4;
export const DEFAULT_MEMORY_TEMPERATURE = 0.2;

const OVERRIDE_PATH = path.join(process.cwd(), "lib", "server", "agent-config.json");

let cache: { ov: AgentOverride; at: number } | null = null;

export async function readOverride(): Promise<AgentOverride> {
  if (cache && Date.now() - cache.at < 1000) return cache.ov;
  let ov: AgentOverride = {};
  try {
    const raw = await fs.readFile(OVERRIDE_PATH, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object") ov = j;
  } catch {
    // 文件不存在/损坏：视作无覆盖，全用默认
  }
  cache = { ov, at: Date.now() };
  return ov;
}

export async function writeOverride(ov: AgentOverride): Promise<void> {
  await fs.writeFile(OVERRIDE_PATH, JSON.stringify(ov, null, 2), "utf8");
  cache = { ov, at: Date.now() }; // 立即更新缓存：本进程内（含正在跑的 dev 服务器）即时生效
}
