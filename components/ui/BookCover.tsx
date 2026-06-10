"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";

// 新中式书封：优先渲染真实封面图（src），加载失败时回退到按 coverSeed 生成的确定性色块美术
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
  src,
  className,
  rounded = "rounded-lg",
  showText = true,
}: {
  title: string;
  author?: string;
  seed: number;
  src?: string;
  className?: string;
  rounded?: string;
  showText?: boolean;
}) {
  const [ok, setOk] = useState(true);
  const p = PALETTES[(seed - 1 + PALETTES.length) % PALETTES.length] ?? PALETTES[0];
  const useArt = !src || !ok;
  return (
    <div
      role="img"
      aria-label={`《${title}》${author ? " " + author : ""}封面`}
      className={cn("relative overflow-hidden shadow-sm", rounded, className)}
      // containerType 使兜底书名的 clamp(...cqw...) 按「封面自身宽度」缩放（否则 cqw 无容器上下文而失效）
      style={{ background: p.bg, aspectRatio: "3 / 4", containerType: "inline-size" }}
    >
      {/* CSS 兜底美术：几何半圆/圆点 新中式留白 */}
      {useArt && (
        <>
          <div
            className="absolute -right-5 -bottom-5 rounded-full"
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
                <div className="mt-1 text-[10px] opacity-70" style={{ color: p.ink }}>
                  {author}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 真实封面图（存在且加载成功时覆盖在兜底美术之上） */}
      {src && ok && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`《${title}》封面`}
          loading="lazy"
          onError={() => setOk(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
