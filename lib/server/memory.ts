// T7 用户长期记忆：服务端异步更新（客户端完全无感）+ 注入智学 system，让小涤"记得这位读者"。
// 数据：user_memory 每用户一行，7 个维度字段；RLS 仅本人可读，写入只走 service_role（本模块）。
// 更新机制：每轮回复完成后由 route 经 waitUntil 托管 fire-and-forget 调 maybeUpdateMemory——
//   攒够 MIN_NEW 条新消息才真正跑（processed_until 记录已消化进度，与压缩器同思路）；
//   由 M3 对照「记忆现值 + 新对话」判断哪些维度需要更新，产出增量合并后的新值写回。
// 防膨胀：模型被要求每维度 ≤120 字提炼，写库前再硬截 MAX_FIELD 字。
import "server-only";
import { admin } from "@/lib/server/agent";
import { chatOnce } from "@/lib/server/minimax";
import { requestView } from "@/lib/server/compress";

const MIN_NEW = 4; // 新消息攒够 4 条（两轮）才值得跑一次模型
const MAX_FIELD = 300; // 单维度硬上限（防膨胀兜底）
const MEMORY_MODEL = process.env.MINIMAX_MEMORY_MODEL || "MiniMax-M3"; // 任务书 T5：全部调用统一 M3

export const MEMORY_FIELDS = [
  ["identity", "身份画像（职业/身份/人生阶段）"],
  ["reading_pref", "阅读偏好（题材/深浅/节奏/读法）"],
  ["interests", "兴趣主题"],
  ["chat_style", "聊天风格偏好（喜欢简短还是详尽、要不要引导）"],
  ["facts", "重要个人事实（家人/宠物/纪念日等读者主动提过的）"],
  ["recent_focus", "近期关注（最近在读什么、在烦什么、目标是什么）"],
  ["follow_ups", "待跟进事项（答应过的、下次该问候的）"],
] as const;

export interface UserMemory {
  identity: string;
  reading_pref: string;
  interests: string;
  chat_style: string;
  facts: string;
  recent_focus: string;
  follow_ups: string;
}

// 防同一用户并发重复更新（serverless 单实例内有效；多实例最坏重复跑一次，幂等无害）
const inflight = new Set<string>();

export function maybeUpdateMemory(uid: string): Promise<void> {
  if (inflight.has(uid)) return Promise.resolve();
  inflight.add(uid);
  return update(uid)
    .catch((e) => console.error("[memory]", e))
    .finally(() => inflight.delete(uid));
}

async function update(uid: string) {
  // 等前端把本轮问答 persist 上云（流结束后约 1 秒内 upsert）：不等的话本轮内容要到下一轮才被消化
  await new Promise((r) => setTimeout(r, 3500));
  const [{ data: sess }, { data: mem }] = await Promise.all([
    admin.from("chat_sessions").select("messages").eq("user_id", uid).eq("id", "main").maybeSingle(),
    admin.from("user_memory").select("*").eq("user_id", uid).maybeSingle(),
  ]);
  if (!sess) return;
  const view = requestView(Array.isArray(sess.messages) ? sess.messages : []);
  const until = mem?.processed_until ?? 0;
  if (view.length - until < MIN_NEW) return; // 没攒够新对话
  const part = view
    .slice(until)
    .map((m) => `${m.role === "user" ? "读者" : "小涤"}：${m.content.slice(0, 400)}`)
    .join("\n");

  const current = MEMORY_FIELDS.map(([k, label]) => `${k}（${label}）：${String((mem as any)?.[k] ?? "").trim() || "（空）"}`).join("\n");
  const out = await chatOnce(
    [
      {
        role: "system",
        content:
          "你是读者记忆管理器。对照「记忆现值」与「新对话」，判断哪些维度需要更新。" +
          "只输出一个 JSON 对象：键 = 需要更新的维度名，值 = 增量合并后的完整新值（保留现值中仍然成立的认知，并入新认知，删除被新信息推翻的旧认知）；" +
          "没有任何维度需要更新时输出 {}。" +
          "要求：每个值 ≤120 字、提炼成认知而非对话摘录、只记读者本人的信息（不记小涤说过什么）、不编造未提及的内容。" +
          "除 JSON 外不要输出任何文字。",
      },
      { role: "user", content: `【记忆现值】\n${current}\n\n【新对话】\n${part}\n\n输出需要更新的维度 JSON：` },
    ],
    { model: MEMORY_MODEL, maxTokens: 4096, temperature: 0.2, timeoutMs: 45000 }
  );

  // 解析（M3 已剥思考；取首 { 到末 } 的最大跨度防夹带）
  let patch: Record<string, unknown> = {};
  const a = out.indexOf("{"), b = out.lastIndexOf("}");
  if (a >= 0 && b > a) { try { patch = JSON.parse(out.slice(a, b + 1)); } catch {} }
  const valid: Record<string, string> = {};
  for (const [k] of MEMORY_FIELDS) {
    if (typeof patch[k] === "string") valid[k] = (patch[k] as string).trim().slice(0, MAX_FIELD);
  }

  await admin.from("user_memory").upsert(
    { user_id: uid, ...(mem ?? {}), ...valid, processed_until: view.length, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
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
