import { cn } from "@/lib/utils";

/**
 * 新中式线性装饰纹样（纯内联 SVG，currentColor 取色）。
 * 通过外层 className 控制颜色/透明度/定位，pointer-events-none 不挡交互。
 * 真实水墨素材就位前，这些 SVG 即可承载「东方典雅」的角花氛围。
 */
type MotifName = "bamboo" | "mountain" | "branch" | "seal" | "cloud";

export function Motif({
  name,
  className,
  size,
}: {
  name: MotifName;
  className?: string;
  size?: number;
}) {
  const common = {
    className: cn("pointer-events-none select-none", className),
    style: size ? { width: size, height: size } : undefined,
    "aria-hidden": true,
    fill: "none" as const,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "bamboo":
      return (
        <svg viewBox="0 0 120 120" {...common}>
          <g strokeWidth={1.4}>
            {/* 两根竹竿 + 竹节 */}
            <path d="M76 4 V70" />
            <path d="M92 0 V60" />
            <path d="M71 22 h10 M71 40 h10 M71 58 h10" />
            <path d="M87 18 h10 M87 36 h10" />
            {/* 竹叶 */}
            <path d="M76 24 q-12 -7 -26 -4 q11 7 26 4 Z" fill="currentColor" fillOpacity={0.12} />
            <path d="M76 42 q-13 -4 -26 2 q12 5 26 -2 Z" fill="currentColor" fillOpacity={0.12} />
            <path d="M92 20 q13 -6 26 -2 q-12 6 -26 2 Z" fill="currentColor" fillOpacity={0.1} />
            <path d="M92 38 q12 -3 24 3 q-12 4 -24 -3 Z" fill="currentColor" fillOpacity={0.1} />
          </g>
        </svg>
      );
    case "mountain":
      return (
        <svg viewBox="0 0 240 90" {...common}>
          <g strokeWidth={1.3}>
            <path d="M0 78 Q40 40 70 60 Q95 76 120 50 Q150 20 185 56 Q210 78 240 58" />
            <path d="M0 88 Q50 64 95 80 Q140 92 185 76 Q215 66 240 82" opacity={0.7} />
            <circle cx={196} cy={26} r={11} fill="currentColor" fillOpacity={0.08} />
          </g>
        </svg>
      );
    case "branch":
      return (
        <svg viewBox="0 0 120 120" {...common}>
          <g strokeWidth={1.4}>
            <path d="M114 8 C92 22 74 36 60 60" />
            <path d="M96 22 q10 -8 20 -7" />
            <path d="M82 36 q11 -6 20 -3" />
            <path d="M70 50 q11 -4 20 0" />
            <path d="M98 20 q-2 -8 3 -15" />
            <path d="M84 34 q-2 -8 3 -14" />
            <path d="M94 21 q9 -3 16 1 q-9 4 -16 -1 Z" fill="currentColor" fillOpacity={0.12} />
            <path d="M80 35 q10 -3 17 1 q-10 4 -17 -1 Z" fill="currentColor" fillOpacity={0.12} />
            <path d="M68 49 q10 -2 17 2 q-10 3 -17 -2 Z" fill="currentColor" fillOpacity={0.1} />
          </g>
        </svg>
      );
    case "cloud":
      return (
        <svg viewBox="0 0 120 60" {...common}>
          <g strokeWidth={1.3}>
            <path d="M8 40 q10 -16 26 -8 q6 -14 24 -8 q14 -10 28 2 q14 -2 18 12" />
            <path d="M14 50 q40 -10 92 0" opacity={0.6} />
          </g>
        </svg>
      );
    case "seal":
      return (
        <svg viewBox="0 0 100 100" {...common}>
          <g strokeWidth={2}>
            <rect x={6} y={6} width={88} height={88} rx={12} />
            <rect x={16} y={16} width={68} height={68} rx={8} opacity={0.5} />
          </g>
        </svg>
      );
  }
}

/** 居中装饰分隔线：—— ◇ —— （用于「共 N 本」等副标题两侧） */
export function OrnDivider({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-celadon/50", className)} aria-hidden>
      <span className="h-px w-6 bg-gradient-to-r from-transparent to-current" />
      <span className="h-1 w-1 rotate-45 bg-current" />
      <span className="h-px w-6 bg-gradient-to-l from-transparent to-current" />
    </span>
  );
}
