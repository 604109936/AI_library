// T2.6 上下文压缩 Agent：会话过长时，把「最近 20 轮之前」的旧消息异步压成摘要存
// chat_sessions.compressed_history（compressed_until 记录已压到第几条）。原始 messages 永久保留（压缩≠删除）。
// 口径说明：规格写的是 ≥500K token 触发；本应用单条消息 ≤500 字，用「消息条数」做等价代理更稳——
//   超过 KEEP+BATCH_MIN 条即压缩，KEEP=40 条（即最近 20 轮）永不参与压缩。
// 工具结果天然不进历史（本架构每次请求内用完即弃），无需额外清除。
import "server-only";
import { admin } from "@/lib/server/agent";
import { chatOnce } from "@/lib/server/minimax";

const KEEP = 40; // 最近 20 轮（40 条）不压缩
const BATCH_MIN = 8; // 新增未压缩消息攒够这个数才值得跑一次压缩
const COMPRESS_MODEL = process.env.MINIMAX_COMPRESS_MODEL || "MiniMax-Text-01"; // 压缩走便宜快的模型

// 防同一会话并发重复压缩（serverless 单实例内有效，多实例最坏重复压一次，幂等无害）
const inflight = new Set<string>();

export function maybeCompress(uid: string, sessionId: string): void {
  const key = `${uid}/${sessionId}`;
  if (inflight.has(key)) return;
  inflight.add(key);
  compress(uid, sessionId)
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
  const msgs: { role: string; content: string }[] = Array.isArray(row.messages) ? row.messages : [];
  const until = row.compressed_until ?? 0;
  const cut = msgs.length - KEEP; // 压到这条为止（保住最近 20 轮）
  if (cut - until < BATCH_MIN) return; // 没攒够，不值得跑

  const part = msgs
    .slice(until, cut)
    .map((m) => `${m.role === "user" ? "读者" : "小涤"}：${String(m.content ?? "").slice(0, 600)}`)
    .join("\n");
  const prev = (row.compressed_history ?? "").trim();

  const summary = await chatOnce(
    [
      {
        role: "system",
        content:
          "你是对话压缩器。把读者与 AI 读书伙伴的旧对话压缩成接续摘要，供 AI 后续对话时回忆上下文。" +
          "保留：读者的阅读偏好与个人情况、讨论过的书与章节、给过的建议与结论、未完成的话题。" +
          "去掉：寒暄、重复、格式装饰。直接输出摘要正文（不要任何前后缀），800 字以内。",
      },
      {
        role: "user",
        content: `${prev ? `【已有摘要（在此基础上合并更新）】\n${prev}\n\n` : ""}【需要并入的旧对话】\n${part}`,
      },
    ],
    { model: COMPRESS_MODEL, maxTokens: 1500, temperature: 0.3 }
  );

  await admin
    .from("chat_sessions")
    .update({ compressed_history: summary.slice(0, 4000), compressed_until: cut })
    .eq("user_id", uid)
    .eq("id", sessionId);
}

// 读取某会话的压缩摘要（注入 System 变量⑥）
export async function getCompressed(uid: string, sessionId: string): Promise<string | undefined> {
  const { data } = await admin
    .from("chat_sessions")
    .select("compressed_history")
    .eq("user_id", uid)
    .eq("id", sessionId)
    .maybeSingle();
  const s = (data?.compressed_history ?? "").trim();
  return s || undefined;
}
