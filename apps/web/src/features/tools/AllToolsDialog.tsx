import { Dialog } from "@pdfloom/ui";
import type { LucideIcon } from "lucide-react";

export interface ToolEntry {
  icon: LucideIcon;
  label: string;
  description: string;
  onSelect: () => void;
  tone?: "default" | "ai";
}

export interface ToolGroup {
  title: string;
  tools: ToolEntry[];
}

/**
 * A single searchable-by-eye grid of every tool in the app, grouped by
 * category — mirrors what a "browse everything" page gets you in other PDF
 * editors, for tools otherwise nested a level deep in a dropdown (Page
 * design, Convert, AI tools). Each card triggers the exact same action its
 * Rail item/dropdown entry does; this is a second entry point, not a
 * separate implementation.
 */
export function AllToolsDialog({ open, onOpenChange, groups }: { open: boolean; onOpenChange: (open: boolean) => void; groups: ToolGroup[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="All tools" description="Everything PDFLoom can do, in one place." width={720}>
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">{group.title}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {group.tools.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  onClick={() => {
                    tool.onSelect();
                    onOpenChange(false);
                  }}
                  className="flex flex-col items-start gap-2 rounded-[--radius-md] border border-border bg-bg-elevated p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-[--radius-sm] ${
                      tool.tone === "ai" ? "bg-ai-muted text-ai" : "bg-primary-muted text-primary"
                    }`}
                  >
                    <tool.icon className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-text">{tool.label}</span>
                    <span className="text-xs leading-snug text-text-faint">{tool.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
