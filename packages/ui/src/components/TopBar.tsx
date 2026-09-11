import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function TopBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        // overflow-x-auto: on a narrow (mobile) viewport this bar's three
        // sections (start/center/end icon groups, a page-number field,
        // zoom controls...) don't all fit. Without this the excess used to
        // get squeezed below its natural width instead of clipped or
        // scrolled — and a squeezed flex child has nowhere to put its text
        // but wrap, which is what turned PageNumberField's "/ 8" into a
        // garbled stack of characters. Scrolling keeps every control
        // reachable (a swipe away) instead of silently unreachable or
        // visually broken.
        "flex h-14 shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-bg-elevated px-3 shadow-(--shadow-sm)",
        className,
      )}
    >
      {children}
    </header>
  );
}

export function TopBarSection({
  children,
  className,
  align = "start",
  grouped = false,
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  /** Wraps the section in a recessed rounded cluster (bg-surface) instead of
   * relying on a thin vertical Separator to read as "these buttons belong
   * together" — a grouped-ribbon feel closer to Acrobat/Sejda's toolbars,
   * used for a related run of icon buttons within one section. */
  grouped?: boolean;
}) {
  return (
    <div
      className={cn(
        // shrink-0: pairs with TopBar's overflow-x-auto above — without it,
        // min-w-0 lets this section get compressed below its own content's
        // natural width when the bar is too narrow to fit everything,
        // which is exactly what forces child text (e.g. PageNumberField's
        // "/ N") to wrap instead of the bar simply scrolling. "center" still
        // grows to claim the leftover space between start/end (so it stays
        // visually centered when everything fits) — grow, not flex-1, so it
        // never shrinks below its own content on the way there.
        "flex min-w-0 shrink-0 items-center gap-1.5",
        align === "center" && "grow justify-center",
        align === "end" && "ml-auto justify-end",
        grouped && "rounded-(--radius-md) bg-surface p-1 gap-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
