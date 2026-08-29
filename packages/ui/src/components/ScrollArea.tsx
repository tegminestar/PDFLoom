import * as RadixScrollArea from "@radix-ui/react-scroll-area";
import { forwardRef, type Ref, type ReactNode, type UIEventHandler } from "react";
import { cn } from "../lib/cn";

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  orientation?: "vertical" | "horizontal" | "both";
  viewportRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ children, className, viewportClassName, orientation = "vertical", viewportRef, onScroll }, ref) => {
    return (
      <RadixScrollArea.Root ref={ref} className={cn("overflow-hidden", className)}>
        <RadixScrollArea.Viewport
          ref={viewportRef}
          onScroll={onScroll}
          className={cn("h-full w-full [&>div]:!block", viewportClassName)}
        >
          {children}
        </RadixScrollArea.Viewport>
        {(orientation === "vertical" || orientation === "both") && (
          <RadixScrollArea.Scrollbar
            orientation="vertical"
            className="flex w-2.5 touch-none select-none p-0.5 transition-colors duration-150 hover:bg-white/5"
          >
            <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border-strong" />
          </RadixScrollArea.Scrollbar>
        )}
        {(orientation === "horizontal" || orientation === "both") && (
          <RadixScrollArea.Scrollbar
            orientation="horizontal"
            className="flex h-2.5 touch-none select-none p-0.5 transition-colors duration-150 hover:bg-white/5"
          >
            <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border-strong" />
          </RadixScrollArea.Scrollbar>
        )}
        <RadixScrollArea.Corner className="bg-transparent" />
      </RadixScrollArea.Root>
    );
  },
);
ScrollArea.displayName = "ScrollArea";
