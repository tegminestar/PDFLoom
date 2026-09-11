import { IconButton, Separator } from "@pdfloom/ui";
import { X } from "lucide-react";
import { useLoomStore } from "../app/store";

/**
 * Mode name + open filename, shared by every mode toolbar (Edit, Annotate,
 * Redact, Sign, Forms) so the document's identity survives leaving the
 * default Toolbar — previously only Toolbar.tsx showed the filename at all,
 * meaning it visibly disappeared the instant you entered any other mode.
 */
export function ToolbarModeLabel({ mode }: { mode: string }) {
  const meta = useLoomStore((s) => s.meta);
  return (
    <span className="mr-2 flex min-w-0 items-baseline gap-2">
      <span className="text-heading font-semibold text-text">{mode}</span>
      {meta && (
        <span className="max-w-[10rem] truncate text-xs text-text-faint" title={meta.name}>
          {meta.name}
        </span>
      )}
    </span>
  );
}

/**
 * One standardized exit affordance — icon-X, "Exit {mode} mode", rightmost
 * after a separator — replacing three different idioms that used to exist
 * across toolbars (this exact pattern, a bare "Cancel" text button in
 * Redact/Forms, no separator in some). The underlying discard/keep behavior
 * each toolbar already had is untouched; only the chrome is unified.
 */
export function ToolbarExitButton({ mode, onExit, disabled }: { mode: string; onExit: () => void; disabled?: boolean }) {
  return (
    <>
      <Separator orientation="vertical" className="mx-1.5 h-6" />
      <IconButton icon={<X />} label={`Exit ${mode} mode`} onClick={onExit} disabled={disabled} showTooltip={false} />
    </>
  );
}
