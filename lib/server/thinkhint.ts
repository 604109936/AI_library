// T8 思考过程包装：把 M3 的 <think> 思考增量加工成面向用户的过程提示短句（≤20 字、第一人称、温暖自然）。
// 方案取舍（决策记录）：规则提取而非模型即时摘要——零延迟零成本，思考期间提示能即时跟上；
// 硬约束：绝不出现工具名/book_id/系统提示词/内部字段/报错信息，只说「在为读者做什么」。
import "server-only";

const clip = (s: string) => (s.length > 20 ? s.slice(0, 19) + "」" : s);

export function makeThinkHint() {
  let buf = "";
  let last = "";
  let emitted = 0;
  return (chunk: string): string | null => {
    buf += chunk;
    if (buf.length < 24) return null; // 攒一点再判断，防首字噪声
    // 信号按优先级匹配：引用/章节类 > 偏好类 > 推荐类 > 书名兜底 > 首次通用句
    const books = buf.match(/《[^》]{1,18}》/g);
    const book = books?.[books.length - 1];
    let hint: string | null = null;
    if (/搜索|联网|网上|最新|时效/.test(buf)) hint = "正在网上帮你查";
    else if (/原文|引用|出处/.test(buf)) hint = "正在核对原文出处";
    else if (/目录|章节|第[一二三四五六七八九十\d]+章|哪一章/.test(buf)) hint = book ? clip(`在${book}里找最相关的章`) : "在比较哪一章最能回答你";
    else if (/偏好|喜欢|读过|阅读记录|笔记|书架|收藏/.test(buf)) hint = "在回想你的阅读足迹";
    else if (/推荐|挑|选书|荐书/.test(buf)) hint = "在书架间为你挑书";
    else if (book) hint = clip(`正在翻看${book}`);
    else if (emitted === 0) hint = "正在帮你琢磨这个问题";
    if (hint && hint !== last) {
      last = hint;
      emitted++;
      buf = buf.slice(-160); // 窗口滑动：只看最近的思考方向，提示随思考推进而更新
      return hint;
    }
    return null;
  };
}
