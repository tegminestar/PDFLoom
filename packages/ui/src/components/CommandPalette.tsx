import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface CommandPaletteItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  keywords?: string[];
  tone?: "default" | "ai";
  onSelect: () => void;
}

export interface CommandPaletteGroup {
  heading: string;
  items: CommandPaletteItem[];
}

export interface CommandPaletteProps {
  groups: CommandPaletteGroup[];
  placeholder?: string;
}

/**
 * Self-contained Cmd/Ctrl+K command palette — mount once in the app shell.
 * It owns its own open state and global shortcut listener so callers just
 * hand it the current command list.
 */
export function CommandPalette({ groups, placeholder = "Type a command or search…" }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isModK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isModK) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const runAndClose = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      shouldFilter
      className="loom-pop fixed left-1/2 top-[18vh] z-[200] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-[--radius-lg] border border-border-strong bg-bg-elevated shadow-[--shadow-floating]"
      overlayClassName="loom-overlay fixed inset-0 z-[199] bg-[--color-overlay]"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-3.5">
        <Search className="h-4 w-4 shrink-0 text-text-faint" />
        <Command.Input
          placeholder={placeholder}
          className="h-12 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
        />
      </div>
      <Command.List className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-text-muted">
          No matching commands.
        </Command.Empty>
        {groups.map((group) => (
          <Command.Group
            key={group.heading}
            heading={group.heading}
            className={cn(
              "px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint",
              "[&_[cmdk-group-items]]:mt-1 [&_[cmdk-group-items]]:text-sm [&_[cmdk-group-items]]:font-normal [&_[cmdk-group-items]]:normal-case [&_[cmdk-group-items]]:tracking-normal",
            )}
          >
            {group.items.map((item) => (
              <Command.Item
                key={item.id}
                value={[item.label, ...(item.keywords ?? [])].join(" ")}
                onSelect={() => runAndClose(item.onSelect)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-[--radius-sm] px-2.5 py-2 text-text",
                  "data-[selected=true]:bg-surface-hover",
                  item.tone === "ai" && "data-[selected=true]:bg-ai-muted",
                )}
              >
                {item.icon && (
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4", item.tone === "ai" ? "text-ai" : "text-text-muted")}>
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 truncate text-sm">{item.label}</span>
                {item.shortcut && (
                  <kbd className="rounded border border-border-strong bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
                    {item.shortcut}
                  </kbd>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
