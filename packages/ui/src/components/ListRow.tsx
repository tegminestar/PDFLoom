import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ListRowProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  /** Rendered at the row's end, e.g. a download/delete IconButton — click events inside it should call stopPropagation if the row itself is also interactive. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Icon/thumbnail + primary text (truncated) + secondary metadata line +
 * an optional trailing slot — the shape of a file/record list row.
 * Originally WelcomeScreen's hand-rolled Recent-files markup; pulled out
 * so any future record-list panel (attachments, recents, anything
 * file-shaped) doesn't re-invent it.
 */
export function ListRow({ icon, title, subtitle, onClick, trailing, className }: ListRowProps) {
  const content = (
    <>
      <span className="flex shrink-0 items-center justify-center text-text-faint">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text" title={title}>
          {title}
        </span>
        {subtitle && <span className="block truncate text-xs text-text-faint">{subtitle}</span>}
      </span>
      {trailing}
    </>
  );

  const sharedClasses = cn("flex w-full items-center gap-3 rounded-[--radius-md] px-2.5 py-2", className);

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(sharedClasses, "text-left hover:bg-surface-hover")}>
        {content}
      </button>
    );
  }
  return <div className={sharedClasses}>{content}</div>;
}
