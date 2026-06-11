// T2.6 上下文压缩 Agent：会话过长时，把「最近 20 轮之前」的旧消息异步压成摘要存
// chat_sessions.compressed_history（compressed_until 记录已压到第几条）。原始 messages 永久保留（压缩≠删除）。
// 口径说明：规格写的是 ≥500K token 触发；本应用单条消息 ≤500 字，用「消息条数」做等价代理更稳——
//   超过 KEEP+BATCH_MIN 条即压缩，KEEP=40 条（即最近 20 轮）永不参与压缩。
// 工具结果天然不进历史（本架构每次请求内用完即弃），无需额外清除。
import "server-only";
import { admin } from "@/lib/server/agent";
import { chatOnce } from "@/lib/server/minimax";
import { stripCardMarkers } from "@/lib/chatMarkers";

const KEEP = 40; // 最近 20 轮（40 条）不压缩
const BATCH_MIN = 8; // 新增未压缩消息攒够这个数才值得跑一次压缩
const COMPRESS_MODEL = process.env.MINIMAX_COMPRESS_MODEL || "MiniMax-M3"; // 任务书 T5：全部调用统一 M3

// 「请求口径」视图：与前端组装上下文的过滤规则完全一致（剔除 error 占位 → 剥卡片标记 → 滤空）。
// compressed_until 必须按这套口径计数：若按 DB 原始数组下标计数，前端请求数组比 DB 短 k 条
// （k=被剔除的 error/空消息数），all.slice(until) 会让边界附近 k 条真实消息「既不在摘要也不在请求」。
export function requestView(msgs: { role?: string; content?: unknown; error?: boolean }[]): { role: string; content: string }[] {
  return msgs
    .filter((m) => !m.error)
    .map((m) => ({ role: String(m.role ?? ""), content: stripCardMarkers(String(m.content ?? "")) }))
    .filter((m) => m.content.trim());
}

// 防同一会话并发重复压缩（serverless 单实例内有效，多实例最坏重复压一次，幂等无害）
const inflight = new Set<string>();

export function maybeCompress(uid: string, sessionId: string): Promise<void> {
  const key = `${uid}/${sessionId}`;
  if (inflight.has(key)) return Promise.resolve();
  inflight.add(key);
  // 返回 Promise 供 waitUntil 托管：serverless 响应关闭后实例会被冻结，fire-and-forget 永远跑不完
  return compress(uid, sessionId)
    .catch((e) => console.error("[compress]", e))
    .finally(() => inflight.delete(key));
}

async function compress(uid: string, sessionId: string) {
  const { data: row } = await admin
    .from("chat_sessions")
    .select("messages, compressed_history, compressed_until")
    .eq("user_id", uid)
    .eq("id", sessionId)
    .maybeSingle();
  if (!row) return;
  // 统一按「请求口径」计数与切片（详见 requestView 注释）：摘要覆盖范围与请求裁剪范围严格互补
  const msgs = requestView(Array.isArray(row.messages) ? row.messages : []);
  const until = row.compressed_until ?? 0;
  const cut = msgs.length - KEEP; // 压到这条为止（保住最近 20 轮）
  if (cut - until < BATCH_MIN) return; // 没攒够，不值得跑

  // 卡片占位标记已在 requestView 剥净：摘要绝不能把 [[recs:…]] 语法带进 system，主模型会学样输出假标记
  const part = msgs
    .slice(until, cut)
    .map((m) => `${m.role === "user" ? "读者" : "小涤"}：${m.content.slice(0, 600)}`)
    .join("\n");
  const prev = (row.compressed_history ?? "").trim();

  // 压缩口径（任务书 T5 放宽）：触发维持「条数代理 500K」，产物放宽到约 5K tokens（中文约 3500 字）——
  // 1500 tokens 压得太猛会丢偏好细节。maxTokens 给 8192：M3 的 <think> 思考也消耗输出预算，必须留足余量
  const summary = await chatOnce(
    [
      {
        role: "system",
        content:
          "你是对话压缩器。把读者与 AI 读书伙伴的旧对话压缩成接续摘要，供 AI 后续对话时回忆上下文。" +
          "保留：读者的阅读偏好与个人情况、讨论过的书与章节、给过的建议与结论、未完成的话题。" +
          "去掉：寒暄、重复、格式装饰。直接输出摘要正文（不要任何前后缀），3500 字以内。",
      },
      {
        role: "user",
        content: `${prev ? `【已有摘要（在此基础上合并更新）】\n${prev}\n\n` : ""}【需要并入的旧对话】\n${part}`,
      },
    ],
    // timeoutMs 100s：M3 长思考 + 3500 字摘要远超 chatOnce 默认 60s（曾导致压缩永远超时、until 停滞）；
    // waitUntil 受 route maxDuration=120s 约束，留 20s 余量
    { model: COMPRESS_MODEL, maxTokens: 8192, temperature: 0.3, timeoutMs: 100_000 }
  );
  // 产物校验：输出被截断在思考段内时 stripThink 会剥成空串——空/过短摘要绝不能写库，
  // 否则 until 推进 + 旧摘要被覆盖 = 不可逆的上下文黑洞；不写库留待下轮重试
  if (summary.trim().length < 50) {
    console.warn("[compress] 摘要产物异常（过短），本轮放弃：", summary.slice(0, 40));
    return;
  }

  await admin
    .from("chat_sessions")
    .update({ compressed_history: summary.slice(0, 16000), compressed_until: cut })
    .eq("user_id", uid)
    .eq("id", sessionId);
}

// 读取某会话的压缩信息（摘要注入 System 变量⑥；until 用于裁剪请求消息——
// 摘要覆盖 [0,until)，请求只需带 until 之后的消息，否则会出现"既不在摘要也不在请求里"的上下文黑洞）
export async function getCompressed(uid: string, sessionId: string): Promise<{ summary?: string; until: number }> {
  const { data } = await admin
    .from("chat_sessions")
    .select("compressed_history, compressed_until")
    .eq("user_id", uid)
    .eq("id", sessionId)
    .maybeSingle();
  const s = (data?.compressed_history ?? "").trim();
  return { summary: s || undefined, until: data?.compressed_until ?? 0 };
}
