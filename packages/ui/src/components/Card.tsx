import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface CardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: "default" | "ai";
  /** `sm` matches a dense grid (tool pickers, templates); `md` matches a spacious feature grid. */
  size?: "sm" | "md";
  /** Renders as a `<button>` when provided, a static `<div>` otherwise. */
  onClick?: () => void;
  className?: string;
}

const SIZE_CLASSES = {
  sm: {
    card: "gap-2 rounded-[--radius-md] p-3",
    iconBox: "h-8 w-8 rounded-[--radius-sm]",
    icon: "h-4 w-4",
    title: "text-sm font-medium",
    description: "text-xs leading-snug",
  },
  md: {
    card: "gap-3 rounded-[--radius-lg] p-5",
    iconBox: "h-9 w-9 rounded-[--radius-md]",
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
          "flex shrink-0 items-center justify-center",
          sizeClasses.iconBox,
          tone === "ai" ? "bg-ai-muted text-ai" : "bg-primary-muted text-primary",
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
    "flex flex-col items-start border border-border bg-bg-elevated text-left transition-colors",
    sizeClasses.card,
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(sharedClasses, "hover:border-border-strong hover:bg-surface-hover")}>
        {content}
      </button>
    );
  }
  return <div className={sharedClasses}>{content}</div>;
}
