import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function TopBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-3",
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
}: {
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        align === "center" && "flex-1 justify-center",
        align === "end" && "ml-auto justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
