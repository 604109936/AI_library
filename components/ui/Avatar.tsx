"use client";
import { useState } from "react";
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

const AVATAR_COUNT = 8;

export function Avatar({
  seed,
  name,
  src,
  size = 40,
  className,
  ring = false,
}: {
  seed: number;
  name?: string;
  src?: string;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const [ok, setOk] = useState(true);
  const bg = AV[(seed - 1 + AV.length) % AV.length] ?? AV[0];
  const ch = name?.trim()?.[0] ?? "读";
  // 默认按 seed 映射到一组真实头像图，缺图时回退首字母色块
  const file = src ?? `/avatars/a${((seed - 1 + AVATAR_COUNT) % AVATAR_COUNT) + 1}.webp`;
  return (
    <div
      role="img"
      aria-label={name ? `${name}的头像` : "头像"}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-serif text-snow",
        ring && "ring-2 ring-celadon/55 ring-offset-1 ring-offset-snow dark:ring-offset-dark-card",
        className
      )}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }}
    >
      {!ok && <span>{ch}</span>}
      {ok && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file}
          alt={name ? `${name}的头像` : "头像"}
          loading="lazy"
          onError={() => setOk(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
