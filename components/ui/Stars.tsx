"use client";
import { Star } from "lucide-react";
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

export function StarPicker({
  value,
  onChange,
  size = 30,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <button key={i} type="button" onClick={() => onChange(i + 1)} className="active:scale-90 transition">
          <Star
            size={size}
            className={i < value ? "text-rouge" : "text-rouge/25"}
            fill="currentColor"
          />
        </button>
      ))}
    </div>
  );
}
