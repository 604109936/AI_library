import { cn } from "@/lib/utils";

// 新中式极简书封：按 coverSeed 生成确定性配色 + 几何留白，无需网络图
const PALETTES = [
  { bg: "linear-gradient(150deg,#EAE7DF,#D6D9CE)", motif: "#7C9885", ink: "#2A2C2E" },
  { bg: "linear-gradient(150deg,#E7ECE6,#C8D6C9)", motif: "#5E7768", ink: "#2A2C2E" },
  { bg: "linear-gradient(150deg,#F0EAE0,#E2D6C2)", motif: "#B89B6E", ink: "#3A352B" },
  { bg: "linear-gradient(150deg,#E6E9EC,#CAD2D8)", motif: "#7C9885", ink: "#2A2C2E" },
  { bg: "linear-gradient(150deg,#EEE6E4,#DCC9C4)", motif: "#A8423A", ink: "#3A2C2A" },
  { bg: "linear-gradient(150deg,#E9E4D9,#CFC7B4)", motif: "#7C9885", ink: "#2A2C2E" },
  { bg: "linear-gradient(150deg,#2A2C28,#1F2A24)", motif: "#7C9885", ink: "#EDE6D6" },
];

export function BookCover({
  title,
  author,
  seed,
  className,
  rounded = "rounded-lg",
  showText = true,
}: {
  title: string;
  author?: string;
  seed: number;
  className?: string;
  rounded?: string;
  showText?: boolean;
}) {
  const p = PALETTES[(seed - 1 + PALETTES.length) % PALETTES.length] ?? PALETTES[0];
  return (
    <div
      className={cn("relative overflow-hidden shadow-sm", rounded, className)}
      style={{ background: p.bg, aspectRatio: "3 / 4" }}
    >
      {/* 几何半圆/圆点 新中式留白 */}
      <div
        className="absolute -right-5 -bottom-5 rounded-full opacity-80"
        style={{ width: "62%", height: "62%", background: p.motif, opacity: 0.22 }}
      />
      <div
        className="absolute right-3 top-3 rounded-full"
        style={{ width: 14, height: 14, border: `1.5px solid ${p.motif}` }}
      />
      {showText && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
          <div
            className="font-serif font-semibold leading-tight tracking-wide"
            style={{ color: p.ink, fontSize: "clamp(13px, 4.2cqw, 22px)" }}
          >
            {title}
          </div>
          {author && (
            <div
              className="mt-1 text-[10px] opacity-70"
              style={{ color: p.ink }}
            >
              {author}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
