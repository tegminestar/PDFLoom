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
    "bg-primary text-primary-text shadow-(--shadow-xs) hover:bg-primary-hover hover:shadow-(--shadow-sm) hover:-translate-y-px active:bg-primary-active active:translate-y-0 active:shadow-(--shadow-xs)",
  secondary:
    "bg-surface text-text border border-border shadow-(--shadow-xs) hover:bg-surface-hover hover:border-border-strong hover:shadow-(--shadow-sm) hover:-translate-y-px active:translate-y-0 active:shadow-(--shadow-xs)",
  ghost: "bg-transparent text-text-muted hover:bg-surface-hover hover:text-text",
  ai: "bg-ai text-ai-text shadow-(--shadow-xs) hover:bg-ai-hover hover:shadow-(--shadow-sm) hover:-translate-y-px active:bg-ai-active active:translate-y-0 active:shadow-(--shadow-xs)",
  danger:
    "bg-danger text-white shadow-(--shadow-xs) hover:bg-danger-hover hover:shadow-(--shadow-sm) hover:-translate-y-px active:bg-danger-active active:translate-y-0 active:shadow-(--shadow-xs)",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5 rounded-(--radius-sm)",
  md: "h-9 px-3.5 text-sm gap-2 rounded-(--radius-md)",
  lg: "h-11 px-5 text-base gap-2 rounded-(--radius-md)",
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
          "transition-[background-color,border-color,box-shadow,transform,color] duration-100 outline-none",
          "focus-visible:ring-2 focus-visible:ring-(--color-focus-ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--color-bg)",
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
