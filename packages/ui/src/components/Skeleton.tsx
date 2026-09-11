import { cn } from "../lib/cn";

export interface SkeletonProps {
  className?: string;
}

/**
 * Loading placeholder — a pulsing block standing in for content not yet
 * available (a list row, an avatar, a line of text). The pulse is the
 * `loom-skeleton` keyframe in tokens.css, which already respects
 * prefers-reduced-motion the same way Dialog's own enter/exit animation
 * does, so this doesn't need its own reduced-motion handling.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn("loom-skeleton rounded-(--radius-sm) bg-surface", className)} />;
}
