import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Tooltip } from "./Tooltip";

export function Rail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <nav
      className={cn(
        "flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-elevated py-3",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export interface RailItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  active?: boolean;
  tone?: "default" | "ai";
}

// forwardRef + spreading `...rest` matters beyond plain ref correctness:
// RailItem is used directly as another Radix primitive's asChild trigger
// (e.g. DropdownMenu wrapping it for the "Page design" menu). That outer
// primitive clones its own onClick/aria-*/ref onto this element — without
// forwarding them through to the real <button>, the outer trigger silently
// never wires up (a real bug hit building the Page design menu).
export const RailItem = forwardRef<HTMLButtonElement, RailItemProps>(
  ({ icon, label, active = false, tone = "default", onClick, className, ...rest }, ref) => {
    return (
      <Tooltip content={label} side="right">
        <button
          ref={ref}
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "relative flex h-11 w-11 items-center justify-center rounded-[--radius-md] outline-none transition-colors duration-100",
            "focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]",
            "[&_svg]:h-5 [&_svg]:w-5",
            active
              ? tone === "ai"
                ? "bg-ai-muted text-ai"
                : "bg-primary-muted text-primary"
              : "text-text-muted hover:bg-surface-hover hover:text-text",
            className,
          )}
          {...rest}
        >
          {active && (
            <span
              className={cn(
                "absolute left-0 h-5 w-0.5 -translate-x-[7px] rounded-full",
                tone === "ai" ? "bg-ai" : "bg-primary",
              )}
            />
          )}
          {icon}
        </button>
      </Tooltip>
    );
  },
);
RailItem.displayName = "RailItem";

export function RailSpacer() {
  return <div className="flex-1" />;
}
