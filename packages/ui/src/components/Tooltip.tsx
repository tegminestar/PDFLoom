import * as RadixTooltip from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../lib/cn";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={100}>
      {children}
    </RadixTooltip.Provider>
  );
}

export interface TooltipProps extends Omit<ComponentPropsWithoutRef<"button">, "content" | "children"> {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  shortcut?: string;
}

// forwardRef + spreading `...rest` onto RadixTooltip.Trigger matters beyond
// ref correctness: when Tooltip is used inside another asChild-composed
// trigger (e.g. wrapping a RailItem as a DropdownMenu trigger), the outer
// primitive clones extra props (onClick, aria-*, data-state) onto whatever
// element Tooltip renders as its root. Without forwarding those through to
// the actual button, they're silently dropped and the outer trigger never
// actually wires up — a real bug caught wiring the "Page design" menu.
export const Tooltip = forwardRef<HTMLButtonElement, TooltipProps>(
  ({ content, children, side = "bottom", shortcut, ...rest }, ref) => {
    return (
      <RadixTooltip.Root>
        <RadixTooltip.Trigger ref={ref} asChild {...rest}>
          {children}
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={8}
            className={cn(
              "loom-pop z-50 flex items-center gap-2 rounded-[--radius-sm] border border-border-strong bg-bg-elevated px-2.5 py-1.5",
              "text-xs font-medium text-text shadow-[--shadow-floating]",
            )}
          >
            {content}
            {shortcut ? (
              <kbd className="rounded border border-border-strong bg-surface px-1 py-0.5 font-mono text-[10px] text-text-faint">
                {shortcut}
              </kbd>
            ) : null}
            <RadixTooltip.Arrow className="fill-bg-elevated" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    );
  },
);
Tooltip.displayName = "Tooltip";
