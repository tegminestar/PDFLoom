import * as RadixDialog from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 440 }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="loom-overlay fixed inset-0 z-[199] bg-[--color-overlay]" />
        <RadixDialog.Content
          style={{ width }}
          className={cn(
            "loom-pop fixed left-1/2 top-1/2 z-[200] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
            "rounded-[--radius-lg] border border-border-strong bg-bg-elevated shadow-[--shadow-floating] outline-none",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <RadixDialog.Title className="text-sm font-semibold text-text">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-xs text-text-muted">{description}</RadixDialog.Description>
              ) : (
                <VisuallyHidden.Root asChild>
                  <RadixDialog.Description>{title}</RadixDialog.Description>
                </VisuallyHidden.Root>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton icon={<X />} label="Close" size="sm" showTooltip={false} />
            </RadixDialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
