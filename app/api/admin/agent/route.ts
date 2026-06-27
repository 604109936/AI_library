// Agent 调试管理后台 API（v1）：读/写「覆盖配置」。出厂默认从源码读，覆盖存 agent-config.json。
// ⚠️ v1 暂无门禁（按你的选择「先直接访问，门禁后做」）；写入仅本地可成功（Vercel 文件系统只读）。
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { BASE_INSTRUCTIONS, buildDataSection, admin } from "@/lib/server/agent";
import { getCompressed, BASE_COMPRESS_PROMPT } from "@/lib/server/compress";
import { BASE_MEMORY_PROMPT, memoryVar } from "@/lib/server/memory";
import { AGENT_TOOLS } from "@/lib/server/tools";
import {
  readOverride, writeOverride, type AgentOverride,
  DEFAULT_MODEL, DEFAULT_TEMPERATURE,
  DEFAULT_COMPRESS_KEEP, DEFAULT_COMPRESS_BATCH_MIN, DEFAULT_COMPRESS_TEMPERATURE,
  DEFAULT_MEMORY_MIN_NEW, DEFAULT_MEMORY_TEMPERATURE,
} from "@/lib/server/agentConfig";

export const runtime = "nodejs";

// 出厂默认（硬编码源 → 作为「默认 / 恢复默认」参照）
const DEFAULTS = {
  systemInstructions: BASE_INSTRUCTIONS,
  toolDescriptions: Object.fromEntries(AGENT_TOOLS.map((t) => [t.function.name, t.function.description ?? ""])) as Record<string, string>,
  model: DEFAULT_MODEL,
  temperature: DEFAULT_TEMPERATURE,
  compressKeep: DEFAULT_COMPRESS_KEEP,
  compressBatchMin: DEFAULT_COMPRESS_BATCH_MIN,
  compressTemperature: DEFAULT_COMPRESS_TEMPERATURE,
  compressPrompt: BASE_COMPRESS_PROMPT,
  memoryMinNew: DEFAULT_MEMORY_MIN_NEW,
  memoryTemperature: DEFAULT_MEMORY_TEMPERATURE,
  memoryPrompt: BASE_MEMORY_PROMPT,
};

// GET：当前生效值（默认 merge 覆盖）+ 出厂默认（供「恢复默认」）。
// ?preview=1：返回运行时注入的「动态数据段」（游客口径，含真实馆藏书单），供「查看完整提示词」只读预览。
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  if (sp.get("preview")) {
    const email = (sp.get("email") ?? "").trim().toLowerCase();
    if (email) {
      // 按邮箱查真实用户 → 用「该用户口径」组装：读者数据②③④⑤ + 长期记忆⑦ + 对话摘要 全部带上
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const u = error ? undefined : data.users.find((x) => (x.email ?? "").toLowerCase() === email);
      if (!u) return NextResponse.json({ dataSection: await buildDataSection(null), found: false, email });
      const compressed = (await getCompressed(u.id, "main").catch(() => ({ summary: undefined as string | undefined }))).summary;
      const memory = await memoryVar(u.id).catch(() => "");
      const dataSection = await buildDataSection(u.id, compressed);
      // compressedHistory=历史压缩值（当前摘要）；memory=历史记忆值（7 维度现值），均供 ④⑤ 区只读查看
      return NextResponse.json({ dataSection, found: true, email, compressedHistory: compressed ?? "", memory: memory ?? "" });
    }
    return NextResponse.json({ dataSection: await buildDataSection(null), found: true, email: "" });
  }
  const ov = await readOverride();
  const effective = {
    systemInstructions: (ov.systemInstructions ?? "").trim() || DEFAULTS.systemInstructions,
    toolDescriptions: Object.fromEntries(
      Object.entries(DEFAULTS.toolDescriptions).map(([k, base]) => {
        const o = ov.toolDescriptions?.[k];
        return [k, o && o.trim() ? o : base];
      })
    ),
    model: ov.model || DEFAULTS.model,
    temperature: typeof ov.temperature === "number" ? ov.temperature : DEFAULTS.temperature,
    compressKeep: typeof ov.compressKeep === "number" ? ov.compressKeep : DEFAULTS.compressKeep,
    compressBatchMin: typeof ov.compressBatchMin === "number" ? ov.compressBatchMin : DEFAULTS.compressBatchMin,
    compressTemperature: typeof ov.compressTemperature === "number" ? ov.compressTemperature : DEFAULTS.compressTemperature,
    compressPrompt: (ov.compressPrompt ?? "").trim() || DEFAULTS.compressPrompt,
    memoryMinNew: typeof ov.memoryMinNew === "number" ? ov.memoryMinNew : DEFAULTS.memoryMinNew,
    memoryTemperature: typeof ov.memoryTemperature === "number" ? ov.memoryTemperature : DEFAULTS.memoryTemperature,
    memoryPrompt: (ov.memoryPrompt ?? "").trim() || DEFAULTS.memoryPrompt,
  };
  return NextResponse.json({ effective, defaults: DEFAULTS });
}

// POST：保存。只存「与默认不同」的项——与默认相同则不写覆盖（默认透出、也不掩盖未来源码改动；清空=恢复默认）
export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 }); }

  const ov: AgentOverride = {};
  const si = typeof body.systemInstructions === "string" ? body.systemInstructions : "";
  if (si.trim() && si.trim() !== DEFAULTS.systemInstructions.trim()) ov.systemInstructions = si;

  const td: Record<string, string> = {};
  for (const [k, base] of Object.entries(DEFAULTS.toolDescriptions)) {
    const v = body.toolDescriptions?.[k];
    if (typeof v === "string" && v.trim() && v.trim() !== base.trim()) td[k] = v;
  }
  if (Object.keys(td).length) ov.toolDescriptions = td;

  if (typeof body.model === "string" && body.model.trim() && body.model.trim() !== DEFAULTS.model) ov.model = body.model.trim();
  const t = Number(body.temperature);
  if (Number.isFinite(t) && t !== DEFAULTS.temperature) ov.temperature = Math.max(0, Math.min(2, t));

  // 对话摘要（compress）
  const ck = Number(body.compressKeep);
  if (Number.isFinite(ck) && Math.round(ck) !== DEFAULTS.compressKeep) ov.compressKeep = Math.max(2, Math.round(ck));
  const cb = Number(body.compressBatchMin);
  if (Number.isFinite(cb) && Math.round(cb) !== DEFAULTS.compressBatchMin) ov.compressBatchMin = Math.max(1, Math.round(cb));
  const ct = Number(body.compressTemperature);
  if (Number.isFinite(ct) && ct !== DEFAULTS.compressTemperature) ov.compressTemperature = Math.max(0, Math.min(2, ct));
  if (typeof body.compressPrompt === "string" && body.compressPrompt.trim() && body.compressPrompt.trim() !== DEFAULTS.compressPrompt.trim()) ov.compressPrompt = body.compressPrompt;
  // 长期记忆（memory）
  const mn = Number(body.memoryMinNew);
  if (Number.isFinite(mn) && Math.round(mn) !== DEFAULTS.memoryMinNew) ov.memoryMinNew = Math.max(1, Math.round(mn));
  const mt = Number(body.memoryTemperature);
  if (Number.isFinite(mt) && mt !== DEFAULTS.memoryTemperature) ov.memoryTemperature = Math.max(0, Math.min(2, mt));
  if (typeof body.memoryPrompt === "string" && body.memoryPrompt.trim() && body.memoryPrompt.trim() !== DEFAULTS.memoryPrompt.trim()) ov.memoryPrompt = body.memoryPrompt;

  try {
    await writeOverride(ov);
  } catch (e) {
    return NextResponse.json({ error: "保存失败（线上文件系统只读，仅本地可写）：" + (e instanceof Error ? e.message : "未知错误") }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
