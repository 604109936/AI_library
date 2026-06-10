// 智学卡片占位标记：让卡片出现在"对话流的真实位置"而非统一挂在气泡末尾。
// 流式中工具事件（推荐书/章节引用）到达时，前端把标记插进正文当前位置：
//   [[recs:起,止]]  → 渲染 msg.recommendations.slice(起,止)
//   [[cites:起,止]] → 渲染 msg.citations.slice(起,止)
// 于是顺序与模型行为一致：先说理由 → 出卡 → 接着说工具调用之后的话；
// 打字机推进到标记处，卡片自然亮相。标记随 content 落库，历史回显按同位置还原。
// 注意：喂回模型的上下文、复制到剪贴板的文本都必须剥掉标记。

export type CardSegment =
  | { kind: "text"; text: string }
  | { kind: "recs" | "cites"; from: number; to: number };

const SPLIT_RE = /\[\[(recs|cites):(\d+),(\d+)\]\]/g;

/** 按占位标记把正文切段（无标记 → 单段全文） */
export function splitCardSegments(content: string): CardSegment[] {
  const out: CardSegment[] = [];
  let last = 0;
  SPLIT_RE.lastIndex = 0;
  for (let m = SPLIT_RE.exec(content); m; m = SPLIT_RE.exec(content)) {
    if (m.index > last) out.push({ kind: "text", text: content.slice(last, m.index) });
    out.push({ kind: m[1] as "recs" | "cites", from: Number(m[2]), to: Number(m[3]) });
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push({ kind: "text", text: content.slice(last) });
  return out;
}

/** 剥掉占位标记（喂回模型 / 复制文本用） */
export function stripCardMarkers(s: string): string {
  return s
    .replace(/[ \t]*\[\[(?:recs|cites):\d+,\d+\]\][ \t]*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 正文里是否已有某类标记（无标记的老消息回退为末尾渲染） */
export function hasCardMarker(content: string, kind: "recs" | "cites"): boolean {
  return content.includes(`[[${kind}:`);
}
