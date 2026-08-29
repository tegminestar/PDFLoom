import * as RadixSwitch from "@radix-ui/react-switch";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, label, disabled, className }, ref) => {
    return (
      <RadixSwitch.Root
        ref={ref}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors duration-150",
          "bg-border-strong data-[state=checked]:bg-primary",
          "focus-visible:ring-2 focus-visible:ring-[--color-focus-ring] focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-bg]",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
      >
        <RadixSwitch.Thumb
          className={cn(
            "block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-150",
            "data-[state=checked]:translate-x-[18px]",
          )}
        />
      </RadixSwitch.Root>
    );
  },
);
Switch.displayName = "Switch";
