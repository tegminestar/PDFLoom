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
  default: "text-text-muted hover:text-text hover:bg-surface-hover",
  active: "text-primary-text bg-primary hover:bg-primary-hover",
  ai: "text-ai hover:text-ai-hover hover:bg-ai-muted",
  ghost: "text-text-muted hover:text-text hover:bg-white/5",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 rounded-[--radius-sm] [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-9 w-9 rounded-[--radius-md] [&_svg]:h-[18px] [&_svg]:w-[18px]",
  lg: "h-11 w-11 rounded-[--radius-md] [&_svg]:h-5 [&_svg]:w-5",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, variant = "default", size = "md", showTooltip = true, shortcut, className, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center transition-colors duration-100 outline-none",
          "focus-visible:ring-2 focus-visible:ring-[--color-focus-ring] focus-visible:ring-offset-1 focus-visible:ring-offset-[--color-bg]",
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
