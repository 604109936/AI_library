"use client";
import { useState } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

/** 「智学」AI 吉祥物（青瓷印章风）。优先真实图 /mascot.png，缺图回退印章框 + 机器人图标。 */
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
        <img src="/mascot.png" alt="智学" onError={() => setOk(false)} className="h-full w-full object-cover" />
      ) : (
        <>
          <span className="absolute rounded-md border border-current/40" style={{ inset: size * 0.16 }} />
          <Bot size={size * 0.48} strokeWidth={1.7} />
        </>
      )}
    </span>
  );
}
