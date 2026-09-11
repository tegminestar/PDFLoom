import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Tooltip } from "./Tooltip";

export type IconButtonVariant = "default" | "active" | "ai" | "ghost";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  showTooltip?: boolean;
  shortcut?: string;
}

const variantClasses: Record<IconButtonVariant, string> = {
  // No resting/hover shadow on default/ghost: these render with zero
  // background most of the time (dense toolbar icon rows), and a shadow
  // under a transparent box reads as a stray phantom mark, not depth — the
  // "elevated" treatment only makes sense once a variant actually has a
  // background to lift (active/ai below, and default's own hover fill).
  default: "text-text-muted hover:text-text hover:bg-surface-hover hover:shadow-(--shadow-xs)",
  // Tinted background, not a solid fill — matches RailItem's own active
  // treatment (bg-primary-muted text-primary) instead of the heavier
  // full-color fill this used to have. A solid-fill "selected" state reads
  // as a primary CTA (Upgrade to Pro, dialog confirms) more than a toggled
  // tool state, and it was the one visual inconsistency between Rail's and
  // every toolbar's idea of "this is the current selection."
  active: "bg-primary-muted text-primary shadow-(--shadow-xs)",
  ai: "text-ai hover:text-ai-hover hover:bg-ai-muted hover:shadow-(--shadow-xs)",
  ghost: "text-text-muted hover:text-text hover:bg-white/5",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 rounded-(--radius-sm) [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-9 w-9 rounded-(--radius-md) [&_svg]:h-[18px] [&_svg]:w-[18px]",
  lg: "h-11 w-11 rounded-(--radius-md) [&_svg]:h-5 [&_svg]:w-5",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, variant = "default", size = "md", showTooltip = true, shortcut, className, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center transition-[background-color,color,box-shadow] duration-100 outline-none",
          "focus-visible:ring-2 focus-visible:ring-(--color-focus-ring) focus-visible:ring-offset-1 focus-visible:ring-offset-(--color-bg)",
          "disabled:pointer-events-none disabled:opacity-30",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {icon}
      </button>
    );

    if (!showTooltip) return button;
    return (
      <Tooltip content={label} {...(shortcut !== undefined && { shortcut })}>
        {button}
      </Tooltip>
    );
  },
);
IconButton.displayName = "IconButton";
