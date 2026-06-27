// T7 用户长期记忆：服务端异步更新（客户端完全无感）+ 注入智学 system，让小涤"记得这位读者"。
// 数据：user_memory 每用户一行，7 个维度字段；RLS 仅本人可读，写入只走 service_role（本模块）。
// 更新机制：每轮回复完成后由 route 经 waitUntil 托管 fire-and-forget 调 maybeUpdateMemory——
//   攒够 MIN_NEW 条新消息才真正跑（processed_until 记录已消化进度，与压缩器同思路）；
//   由 M3 对照「记忆现值 + 新对话」判断哪些维度需要更新，产出增量合并后的新值写回。
// 防膨胀：模型被要求每维度 ≤1000 字提炼，写库前再硬截 MAX_FIELD 字。
import "server-only";
import { admin } from "@/lib/server/agent";
import { chatOnce } from "@/lib/server/minimax";
import { requestView } from "@/lib/server/compress";
import { readOverride, DEFAULT_MEMORY_MIN_NEW, DEFAULT_MEMORY_TEMPERATURE } from "@/lib/server/agentConfig";

// MIN_NEW（攒够多少条才更新）/ 温度 / 提示词 已移到后台可调（readOverride，默认见 agentConfig）
const CATCH_UP = 40; // 单轮最多消化的消息数：存量长会话首跑（until=0）不限量会让 part 膨胀到必超时，
//                      且失败不推进 → 永久死循环白烧 token；分多轮追平
const MAX_FIELD = 1000; // 单维度硬上限（防膨胀兜底）
const MEMORY_MODEL = process.env.MINIMAX_MEMORY_MODEL || "MiniMax-M3"; // 任务书 T5：全部调用统一 M3
// 出厂默认记忆管理器指令（后台可覆盖）
export const BASE_MEMORY_PROMPT =
  "你是读者记忆管理器。对照「记忆现值」与「新对话」，判断哪些维度需要更新。" +
  "只输出一个 JSON 对象：键 = 需要更新的维度名，值 = 增量合并后的完整新值（保留现值中仍然成立的认知，并入新认知，删除被新信息推翻的旧认知）；" +
  "没有任何维度需要更新时输出 {}。" +
  "要求：每个值 ≤1000 字、提炼成认知而非对话摘录、只记读者本人的信息（不记小涤说过什么）、不编造未提及的内容。" +
  "除 JSON 外不要输出任何文字。";

export const MEMORY_FIELDS = [
  ["identity", "身份画像（职业/身份/人生阶段）"],
  ["reading_pref", "阅读偏好（题材/深浅/节奏/读法）"],
  ["interests", "兴趣主题"],
  ["chat_style", "聊天风格偏好（喜欢简短还是详尽、要不要引导）"],
  ["facts", "重要个人事实（家人/宠物/纪念日等读者主动提过的）"],
  ["recent_focus", "近期关注（最近在读什么、在烦什么、目标是什么）"],
  ["follow_ups", "待跟进事项（答应过的、下次该问候的）"],
] as const;

// 防同一用户并发重复更新（serverless 单实例内有效；多实例最坏重复跑一次，幂等无害）
const inflight = new Set<string>();

export function maybeUpdateMemory(uid: string, budgetMs = Number.POSITIVE_INFINITY): Promise<void> {
  if (inflight.has(uid)) return Promise.resolve();
  inflight.add(uid);
  return update(uid, budgetMs)
    .catch((e) => console.error("[memory]", e))
    .finally(() => inflight.delete(uid));
}

async function update(uid: string, budgetMs: number) {
  const t0 = Date.now();
  // 等前端把本轮问答 persist 上云（流结束后约 1 秒内 upsert）：不等的话本轮内容要到下一轮才被消化
  await new Promise((r) => setTimeout(r, 3500));
  const [sessR, memR, ov] = await Promise.all([
    admin.from("chat_sessions").select("messages").eq("user_id", uid).eq("id", "main").maybeSingle(),
    admin.from("user_memory").select("*").eq("user_id", uid).maybeSingle(),
    readOverride(),
  ]);
  // 读库错误与"无行"必须区分：瞬时 DB 错误若被当成新用户，会以空基底全量重建并覆盖现值
  if (sessR.error || memR.error) { console.error("[memory] 读库失败：", sessR.error ?? memR.error); return; }
  const sess = sessR.data;
  const mem = memR.data;
  if (!sess) return;
  const view = requestView(Array.isArray(sess.messages) ? sess.messages : []);
  const until = mem?.processed_until ?? 0;
  // 单轮限量追赶：只消化 [until, target)，processed_until 推进到 target 而非 view.length
  const target = Math.min(view.length, until + CATCH_UP);
  if (target - until < (ov.memoryMinNew ?? DEFAULT_MEMORY_MIN_NEW)) return; // 没攒够新对话
  // 预算检查：长回答后的剩余窗口放不下一次 45s 调用时直接跳过（跑一半被硬杀=白烧且无日志）
  const timeoutMs = Math.min(45_000, budgetMs - (Date.now() - t0) - 5_000);
  if (timeoutMs < 15_000) { console.warn("[memory] 本轮剩余预算不足，跳过"); return; }
  const part = view
    .slice(until, target)
    .map((m) => `${m.role === "user" ? "读者" : "小涤"}：${m.content.slice(0, 400)}`)
    .join("\n");

  const current = MEMORY_FIELDS.map(([k, label]) => `${k}（${label}）：${String((mem as any)?.[k] ?? "").trim() || "（空）"}`).join("\n");
  const out = await chatOnce(
    [
      {
        role: "system",
        content: (ov.memoryPrompt ?? "").trim() || BASE_MEMORY_PROMPT,
      },
      { role: "user", content: `【记忆现值】\n${current}\n\n【新对话】\n${part}\n\n输出需要更新的维度 JSON：` },
    ],
    { model: MEMORY_MODEL, maxTokens: 16384, temperature: ov.memoryTemperature ?? DEFAULT_MEMORY_TEMPERATURE, timeoutMs }
  );

  // 解析（M3 已剥思考；取首 { 到末 } 的最大跨度防夹带）。
  // 解析失败 ≠ 模型判定无需更新（合法 {}）：失败必须直接返回不推进 processed_until，
  // 否则这批对话被标记"已消化"、其中的记忆静默永久丢失；留待下轮带更多消息重试
  const a = out.indexOf("{"), b = out.lastIndexOf("}");
  if (a < 0 || b <= a) return;
  let patch: Record<string, unknown>;
  try { patch = JSON.parse(out.slice(a, b + 1)); } catch { return; }
  const valid: Record<string, string> = {};
  for (const [k] of MEMORY_FIELDS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (typeof v === "string") { const t = v.trim().slice(0, MAX_FIELD); if (t) valid[k] = t; } // 空串/纯空白=本维度无更新，绝不覆盖现值（防记忆被某次模型抖动静默清空·Bug#3）
    else if (typeof v === "number" || typeof v === "boolean") valid[k] = String(v); // 偶发标量容错
    // 维度值类型不对（null/嵌套对象）：视同解析失败整批放弃、不推进进度——
    // 原实现静默丢弃该维度却照常推进，这批认知会被标记"已消化"而永久丢失
    else return;
  }

  // 只写有效字段 + 进度（upsert 未提供的列在 UPDATE 时保持现值）：
  // 整行展开旧基底会在多实例并发时用旧值覆盖别处刚写的新记忆
  const { error: upErr } = await admin.from("user_memory").upsert(
    { user_id: uid, ...valid, processed_until: target, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
  if (upErr) console.error("[memory] 写记忆失败：", upErr); // 静默链路必须留痕（下轮会自动重试）
}

/** 读取记忆并拼成 system 注入段（无记忆返回空串） */
export async function memoryVar(uid: string): Promise<string> {
  const { data: mem } = await admin.from("user_memory").select("*").eq("user_id", uid).maybeSingle();
  if (!mem) return "";
  const lines = MEMORY_FIELDS
    .map(([k, label]) => {
      const v = String((mem as any)[k] ?? "").trim();
      return v ? `- ${label.split("（")[0]}：${v}` : null;
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : "";
}
