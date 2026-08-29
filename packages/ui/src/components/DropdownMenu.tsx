import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface DropdownMenuItemData {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownMenuItemData[];
  align?: "start" | "center" | "end";
}

export function DropdownMenu({ trigger, items, align = "start" }: DropdownMenuProps) {
  return (
    <RadixDropdownMenu.Root>
      <RadixDropdownMenu.Trigger asChild>{trigger}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          align={align}
          sideOffset={8}
          className={cn(
            "loom-pop z-50 min-w-[220px] overflow-hidden rounded-[--radius-md] border border-border-strong bg-bg-elevated p-1 shadow-[--shadow-floating]",
          )}
        >
          {items.map((item) => (
            <RadixDropdownMenu.Item
              key={item.id}
              disabled={item.disabled ?? false}
              onSelect={item.onSelect}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-[--radius-sm] px-2.5 py-2 text-sm text-text outline-none",
                "data-[highlighted]:bg-surface-hover",
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
              )}
            >
              {item.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-muted [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span>}
              {item.label}
            </RadixDropdownMenu.Item>
          ))}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}
