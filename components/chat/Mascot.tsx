"use client";
import { useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/** 「智学」AI 读书伙伴头像（新中式馆主形象）。优先真实图 /mascot.webp，缺图回退印章框 + 人物图标。 */
export function Mascot({ size = 40, className }: { size?: number; className?: string }) {
  const [ok, setOk] = useState(true);
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-2xl bg-celadon-soft text-celadon-700 dark:bg-celadon/20 dark:text-celadon-300",
        className
      )}
      style={{ width: size, height: size }}
    >
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/mascot.webp" alt="智学" onError={() => setOk(false)} className="h-full w-full object-cover" />
      ) : (
        <>
          <span className="absolute rounded-md border border-current/40" style={{ inset: size * 0.16 }} />
          <UserRound size={size * 0.46} strokeWidth={1.7} />
        </>
      )}
    </span>
  );
}
