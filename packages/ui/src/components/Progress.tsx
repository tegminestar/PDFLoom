import { cn } from "../lib/cn";

export interface ProgressProps {
  /** 0-100. Values outside that range are clamped. */
  value: number;
  label?: string;
  className?: string;
}

/**
 * Determinate progress bar — forms fill-in ("M of N fields filled"),
 * multi-step wizards. A track + filled bar, not a spinner: every current
 * use of this is a known, countable total, never an indeterminate wait.
 */
export function Progress({ value, label, className }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && <span className="text-xs text-text-faint">{label}</span>}
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${clamped}%`, transitionDuration: "var(--duration-slow)", transitionTimingFunction: "var(--ease-emphasized)" }}
        />
      </div>
    </div>
  );
}
