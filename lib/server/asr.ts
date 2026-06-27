// 火山引擎 豆包大模型语音识别。两种接入，按 VOLC_ASR_MODE 选：
//   - "flash"（极速版，推荐）：同步一次 POST 直接返回文字，无轮询，低延迟——「说完放手就出字」。
//                              需在控制台开通「极速版」，资源号 volc.bigasr.auc_turbo（按账号实测）。
//   - "standard"（默认，录音文件标准版）：异步 submit + 轮询 query，为文件设计，长音频偏慢。
// 鉴权：X-Api-App-Key=AppID、X-Api-Access-Key=Access Token、X-Api-Resource-Id=资源号。
// 输入：前端自编码的 16k 单声道 16bit WAV（base64 内联到 audio.data，免对象存储中转）。
// 协议依据：官方 6561/1354868（标准版）+ 1631584（极速版 flash/audio.data）+ 多个真实代码交叉验证、本机实测。
import "server-only";
import { randomUUID } from "node:crypto";

const APP_ID = process.env.VOLC_ASR_APP_ID;
const ACCESS_TOKEN = process.env.VOLC_ASR_ACCESS_TOKEN;
const MODE = (process.env.VOLC_ASR_MODE || "standard").toLowerCase(); // "flash" | "standard"
// 标准版资源号：本账号实测授权的是 volc.seedasr.auc（volc.bigasr.auc 报 45000030 未授权）
const RESOURCE_ID = process.env.VOLC_ASR_RESOURCE_ID || "volc.seedasr.auc";
// 极速版资源号：实测 volc.bigasr.auc_turbo「有效但未授权」，开通后即可用；如账号是 seedasr 系另行实测覆盖
const FLASH_RESOURCE_ID = process.env.VOLC_ASR_FLASH_RESOURCE_ID || "volc.bigasr.auc_turbo";
const BASE = "https://openspeech.bytedance.com/api/v3/auc/bigmodel";

const SUCCESS = "20000000"; // 成功，结果就绪
const SILENCE = "20000003"; // 静音/空音频——按"没听清"处理（返回空串，非报错）
// 处理中：20000001 排队 / 20000002 识别中 → 继续轮询（仅标准版）

export function asrConfigured(): boolean {
  return !!(APP_ID && ACCESS_TOKEN);
}

function headers(requestId: string, resource: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Api-App-Key": APP_ID!,
    "X-Api-Access-Key": ACCESS_TOKEN!,
    "X-Api-Resource-Id": resource,
    "X-Api-Request-Id": requestId,
  };
}

function reqBody(wavBase64: string): string {
  return JSON.stringify({
    user: { uid: "ai-library" },
    audio: { data: wavBase64, format: "wav", codec: "raw" }, // WAV 头自带采样率/位深/声道，无需手填
    request: { model_name: "bigmodel", enable_itn: true, enable_punc: true },
  });
}

// 文字优先取 result.text；缺失时退回拼接 utterances[].text
function extractText(j: any): string {
  const r = j?.result;
  if (typeof r?.text === "string" && r.text.trim()) return r.text.trim();
  if (Array.isArray(r?.utterances)) return r.utterances.map((u: any) => u?.text ?? "").join("").trim();
  return "";
}

// ===== 极速版 flash：同步一次返回 =====
async function transcribeFlash(wavBase64: string): Promise<string> {
  const res = await fetch(`${BASE}/recognize/flash`, {
    method: "POST",
    headers: headers(randomUUID(), FLASH_RESOURCE_ID),
    body: reqBody(wavBase64),
    cache: "no-store",
  });
  const code = res.headers.get("X-Api-Status-Code");
  if (code === SUCCESS) return extractText(await res.json().catch(() => null));
  if (code === SILENCE) return "";
  const msg = res.headers.get("X-Api-Message") || (await res.text().catch(() => ""));
  throw new Error(`flash code=${code} ${msg} (resource=${FLASH_RESOURCE_ID})`.trim());
}

// ===== 标准版：异步 submit + 轮询 query =====
async function submit(wavBase64: string, requestId: string): Promise<void> {
  const res = await fetch(`${BASE}/submit`, {
    method: "POST",
    headers: { ...headers(requestId, RESOURCE_ID), "X-Api-Sequence": "-1" },
    body: reqBody(wavBase64),
    cache: "no-store",
  });
  const code = res.headers.get("X-Api-Status-Code");
  if (code !== SUCCESS) {
    const msg = res.headers.get("X-Api-Message") || (await res.text().catch(() => ""));
    throw new Error(`submit code=${code} ${msg} (resource=${RESOURCE_ID})`.trim());
  }
}

async function query(requestId: string): Promise<string | null> {
  const res = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: headers(requestId, RESOURCE_ID),
    body: "{}",
    cache: "no-store",
  });
  const code = res.headers.get("X-Api-Status-Code");
  if (code === SUCCESS) return extractText(await res.json().catch(() => null));
  if (code === "20000001" || code === "20000002") return null; // 处理中
  if (code === SILENCE) return "";
  const msg = res.headers.get("X-Api-Message") || "";
  throw new Error(`query code=${code} ${msg}`.trim());
}

async function transcribeStandard(wavBase64: string): Promise<string> {
  const requestId = randomUUID();
  await submit(wavBase64, requestId);
  const deadline = Date.now() + 25_000; // 放宽到 25s：长录音也别误报失败（前端有「识别中」提示）
  while (Date.now() < deadline) {
    const text = await query(requestId);
    if (text !== null) return text;
    await new Promise((r) => setTimeout(r, 250)); // 加快轮询：短句更快出
  }
  throw new Error("识别超时");
}

// 一次完整识别。flash 模式同步直返（最快）；standard 模式异步轮询。
export async function transcribeWav(wav: ArrayBuffer): Promise<string> {
  if (!asrConfigured()) throw new Error("未配置 VOLC_ASR_APP_ID / VOLC_ASR_ACCESS_TOKEN");
  const wavBase64 = Buffer.from(wav).toString("base64");
  return MODE === "flash" ? transcribeFlash(wavBase64) : transcribeStandard(wavBase64);
}
