"use client";
import { Star } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function Stars({
  value,
  size = 14,
  className,
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {Array.from({ length: 5 }).map((_, i) => {
        const active = i < full;
        const isHalf = i === full && half;
        return (
          <span key={i} className="relative" style={{ width: size, height: size }}>
            <Star size={size} className="text-rouge/30" fill="currentColor" />
            {(active || isHalf) && (
              <span
                className="absolute left-0 top-0 overflow-hidden"
                style={{ width: isHalf ? size / 2 : size, height: size }}
              >
                <Star size={size} className="text-rouge" fill="currentColor" />
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** 支持半星：点击星左半 = x.5，右半 = x.0 */
export function StarPicker({
  value,
  onChange,
  size = 32,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  const tip = Math.ceil(value); // 当前选中的最末一颗星（半星向上取整）
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: 5 }).map((_, i) => {
        const idx = i + 1;
        const full = value >= idx;
        const half = !full && value >= idx - 0.5;
        const isTip = value > 0 && idx === tip;
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            {/* 选中最末星时换 key 重挂载 → 触发一次 spring 弹跳（damping 低带轻微过冲） */}
            <motion.span
              key={isTip ? `picked-${value}` : "idle"}
              initial={isTip ? { scale: 0.5 } : false}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 480, damping: 13 }}
              className="absolute inset-0 block"
            >
              <Star size={size} className="text-rouge/25" fill="currentColor" />
              {(full || half) && (
                <span className="absolute left-0 top-0 overflow-hidden" style={{ width: half ? size / 2 : size, height: size }}>
                  <Star size={size} className="text-rouge" fill="currentColor" />
                </span>
              )}
            </motion.span>
            {/* 触区 ≥40px：纵向扩到 44px、横向各外扩 4px（恰好填满 gap-2），视觉不变 */}
            <button type="button" aria-label={`${idx - 0.5} 星`} onClick={() => onChange(idx - 0.5)} className="absolute -left-1 top-1/2 h-11 w-[calc(50%+4px)] -translate-y-1/2" />
            <button type="button" aria-label={`${idx} 星`} onClick={() => onChange(idx)} className="absolute -right-1 top-1/2 h-11 w-[calc(50%+4px)] -translate-y-1/2" />
          </span>
        );
      })}
    </div>
  );
}
