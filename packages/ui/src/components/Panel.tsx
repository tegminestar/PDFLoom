import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";
import { ScrollArea } from "./ScrollArea";

export interface PanelProps {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  side?: "left" | "right";
  headerActions?: ReactNode;
  width?: number;
  className?: string;
}

export function Panel({ title, children, onClose, side = "left", headerActions, width = 260, className }: PanelProps) {
  return (
    <aside
      style={{ width }}
      className={cn(
        "flex shrink-0 flex-col bg-bg-elevated",
        side === "left" ? "border-r border-border" : "border-l border-border",
        className,
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
        <div className="flex items-center gap-1">
          {headerActions}
          {onClose && (
            <IconButton icon={<X />} label="Close panel" size="sm" onClick={onClose} showTooltip={false} />
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">{children}</div>
      </ScrollArea>
    </aside>
  );
}
