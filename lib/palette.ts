// 全站「生成式色板」单一来源：书封兜底美术 / 头像底色 / 阅读高亮笔。
// 集中于此，避免在 BookCover/Avatar/阅读器里各自硬编码一套游离 token 的色值。

/** 书封 CSS 兜底美术：低饱和新中式渐变 + 主纹样色 + 文字墨色 */
export const COVER_PALETTES = [
  { bg: "linear-gradient(150deg,#EAE7DF,#D6D9CE)", motif: "#7C9885", ink: "#2A2C2E" },
  { bg: "linear-gradient(150deg,#E7ECE6,#C8D6C9)", motif: "#5E7768", ink: "#2A2C2E" },
  { bg: "linear-gradient(150deg,#F0EAE0,#E2D6C2)", motif: "#B89B6E", ink: "#3A352B" },
  { bg: "linear-gradient(150deg,#E6E9EC,#CAD2D8)", motif: "#7C9885", ink: "#2A2C2E" },
  { bg: "linear-gradient(150deg,#EEE6E4,#DCC9C4)", motif: "#A8423A", ink: "#3A2C2A" },
  { bg: "linear-gradient(150deg,#E9E4D9,#CFC7B4)", motif: "#7C9885", ink: "#2A2C2E" },
  { bg: "linear-gradient(150deg,#2A2C28,#1F2A24)", motif: "#7C9885", ink: "#EDE6D6" },
];

/** 头像底色渐变 */
export const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#9DB3A3,#7C9885)",
  "linear-gradient(135deg,#C9B79C,#B89B6E)",
  "linear-gradient(135deg,#A9BBC9,#7E97AC)",
  "linear-gradient(135deg,#C7A8A2,#A8423A)",
  "linear-gradient(135deg,#AEB7A0,#8A9B78)",
  "linear-gradient(135deg,#B6A7C2,#8E7CA0)",
  "linear-gradient(135deg,#9DB3A3,#5E7768)",
];

/** 阅读高亮笔：低饱和新中式（青瓷/黄铜/胭脂/淡墨）。name 用于无障碍标签区分。 */
export const HIGHLIGHTS = [
  { key: "celadon", name: "青瓷", color: "#8FB39B" },
  { key: "brass", name: "黄铜", color: "#D9C08A" },
  { key: "rouge", name: "胭脂", color: "#D69A95" },
  { key: "ink", name: "淡墨", color: "#C9C6BE" },
] as const;
export const HIGHLIGHT_COLORS = HIGHLIGHTS.map((h) => h.color);
