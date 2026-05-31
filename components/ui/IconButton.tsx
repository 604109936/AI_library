"use client";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** 统一图标按钮：≥36px 命中区 + 按压反馈 + 必填无障碍名。
 *  替代各处 13~21px 的裸图标可点元素（赞/踩/复制/删除等）。
 *  active 传入时作为 toggle 暴露 aria-pressed。 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    onClick?: () => void;
    active?: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
    className?: string;
    children: React.ReactNode;
  }
>(function IconButton(
  { label, onClick, active, disabled, type = "button", className, children },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40",
        className
      )}
    >
      {children}
    </button>
  );
});
