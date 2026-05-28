import { cn } from "@/lib/utils";

const AV = [
  "linear-gradient(135deg,#9DB3A3,#7C9885)",
  "linear-gradient(135deg,#C9B79C,#B89B6E)",
  "linear-gradient(135deg,#A9BBC9,#7E97AC)",
  "linear-gradient(135deg,#C7A8A2,#A8423A)",
  "linear-gradient(135deg,#AEB7A0,#8A9B78)",
  "linear-gradient(135deg,#B6A7C2,#8E7CA0)",
  "linear-gradient(135deg,#9DB3A3,#5E7768)",
];

export function Avatar({
  seed,
  name,
  size = 40,
  className,
}: {
  seed: number;
  name?: string;
  size?: number;
  className?: string;
}) {
  const bg = AV[(seed - 1 + AV.length) % AV.length] ?? AV[0];
  const ch = name?.trim()?.[0] ?? "读";
  return (
    <div
      className={cn("flex items-center justify-center rounded-full text-snow font-serif", className)}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }}
    >
      {ch}
    </div>
  );
}
