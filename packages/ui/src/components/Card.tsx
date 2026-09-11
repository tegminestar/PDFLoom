import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface CardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: "default" | "ai";
  /** `xs` drops the description for a very dense browsing grid (large template libraries); `sm` matches a dense grid (tool pickers, templates); `md` matches a spacious feature grid. */
  size?: "xs" | "sm" | "md";
  /** Renders as a `<button>` when provided, a static `<div>` otherwise. */
  onClick?: () => void;
  className?: string;
}

const SIZE_CLASSES = {
  xs: {
    card: "gap-1.5 rounded-(--radius-sm) p-2",
    iconBox: "h-6 w-6 rounded-(--radius-sm)",
    icon: "h-3.5 w-3.5",
    title: "text-xs font-medium leading-snug",
    description: "hidden",
  },
  sm: {
    card: "gap-2 rounded-(--radius-md) p-3",
    iconBox: "h-8 w-8 rounded-(--radius-sm)",
    icon: "h-4 w-4",
    title: "text-sm font-medium",
    description: "text-xs leading-snug",
  },
  md: {
    card: "gap-3 rounded-(--radius-lg) p-5",
    iconBox: "h-9 w-9 rounded-(--radius-md)",
    icon: "h-[18px] w-[18px]",
    title: "text-sm font-semibold",
    description: "text-sm leading-relaxed",
  },
} as const;

/**
 * Icon-in-tinted-square + title + description — the one shape three
 * different surfaces (AllToolsDialog's tool grid, LandingPage's feature
 * grid, WelcomeScreen's template grid) each hand-rolled slightly
 * differently before this existed, with subtly inconsistent hover/border
 * treatments. This is the single source of truth for that shape now.
 */
export function Card({ icon: Icon, title, description, tone = "default", size = "md", onClick, className }: CardProps) {
  const sizeClasses = SIZE_CLASSES[size];
  const content = (
    <>
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden",
          sizeClasses.iconBox,
          tone === "ai" ? "bg-gradient-to-br from-ai/30 via-ai/10 to-transparent text-ai" : "bg-gradient-to-br from-primary/30 via-primary/10 to-transparent text-primary",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),inset_0_-6px_10px_-6px_rgba(0,0,0,0.15)]",
        )}
      >
        <Icon className={sizeClasses.icon} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className={cn(sizeClasses.title, "text-text")}>{title}</span>
        <span className={cn(sizeClasses.description, "text-text-faint")}>{description}</span>
      </div>
    </>
  );

  const sharedClasses = cn(
    "flex flex-col items-start border border-border bg-bg-elevated text-left shadow-(--shadow-xs) transition-[background-color,border-color,box-shadow,transform]",
    sizeClasses.card,
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          sharedClasses,
          "hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-hover hover:shadow-(--shadow-sm) active:translate-y-0 active:shadow-(--shadow-xs)",
        )}
      >
        {content}
      </button>
    );
  }
  return <div className={sharedClasses}>{content}</div>;
}
