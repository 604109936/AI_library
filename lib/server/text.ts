// 服务端文本工具：安全截断。
// 朴素 slice 按 UTF-16 码元截断，切点落在代理对（emoji/生僻字）中间会产生孤立代理项——
// 进入发往 MiniMax 的 JSON 时序列化为未配对 \udXXX（部分服务端解码报错），进前端展示则渲染成 "�"。
import "server-only";

/** 按 UTF-16 码元截断但绝不切断代理对：切点落在高位代理上时回退一位 */
export function cutSafe(s: string, n: number): string {
  if (s.length <= n) return s;
  const t = s.slice(0, n);
  const c = t.charCodeAt(t.length - 1);
  return c >= 0xd800 && c <= 0xdbff ? t.slice(0, -1) : t;
}
