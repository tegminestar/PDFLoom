import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "ai" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-text hover:bg-primary-hover active:bg-primary-active shadow-sm shadow-black/20",
  secondary:
    "bg-surface text-text border border-border hover:bg-surface-hover hover:border-border-strong",
  ghost: "bg-transparent text-text-muted hover:bg-surface-hover hover:text-text",
  ai: "bg-ai text-ai-text hover:bg-ai-hover active:bg-ai-active shadow-sm shadow-black/20",
  danger: "bg-danger text-white hover:bg-danger-hover",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5 rounded-[--radius-sm]",
  md: "h-9 px-3.5 text-sm gap-2 rounded-[--radius-md]",
  lg: "h-11 px-5 text-base gap-2 rounded-[--radius-md]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", asChild = false, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex select-none items-center justify-center font-medium",
          "transition-colors duration-100 outline-none",
          "focus-visible:ring-2 focus-visible:ring-[--color-focus-ring] focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-bg]",
          "disabled:pointer-events-none disabled:opacity-40",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
