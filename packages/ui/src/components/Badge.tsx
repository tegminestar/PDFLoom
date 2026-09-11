import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type BadgeTone = "neutral" | "primary" | "ai" | "success" | "warning" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface text-text-muted border-border",
  primary: "bg-primary-muted text-primary border-transparent",
  ai: "bg-ai-muted text-ai border-transparent",
  success: "bg-success-muted text-success border-transparent",
  warning: "bg-warning-muted text-warning border-transparent",
  danger: "bg-danger-muted text-danger border-transparent",
};

/**
 * Status pill — completed/pending/declined/voided on signature requests,
 * Pro on account chrome. Tinted-background + border pattern matches
 * IconButton's "active" treatment rather than a solid fill, so a badge
 * reads as a label, not a call to action.
 */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-none",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
