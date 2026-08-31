import { getPdfWorkerClient, STANDARD_PAGE_SIZES, type PageSize } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

const PRESET_KEYS = Object.keys(STANDARD_PAGE_SIZES);

export function ResizeDialog({
  open,
  onOpenChange,
  selectedPageNumbers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 1-based page numbers currently selected in the Organize grid — empty means "no selection", so scope defaults to all pages. */
  selectedPageNumbers: number[];
}) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [scope, setScope] = useState<"all" | "selected">(selectedPageNumbers.length > 0 ? "selected" : "all");
  const [presetKey, setPresetKey] = useState<string>("letter");
  const [customWidth, setCustomWidth] = useState(612);
  const [customHeight, setCustomHeight] = useState(792);
  const [isApplying, setIsApplying] = useState(false);

  const targetSize: PageSize =
    presetKey === "custom" ? { width: customWidth, height: customHeight } : (STANDARD_PAGE_SIZES[presetKey]?.size ?? STANDARD_PAGE_SIZES["letter"]!.size);

  const pageCount = meta?.pageCount ?? 0;
  const targetPages = scope === "selected" && selectedPageNumbers.length > 0 ? selectedPageNumbers : Array.from({ length: pageCount }, (_, i) => i + 1);
  const isValid = targetSize.width >= 72 && targetSize.height >= 72 && targetPages.length > 0;

  const handleApply = async () => {
    if (!doc || !isValid) return;
    setIsApplying(true);
    try {
      const bytes = await doc.getRawBytes();
      const client = await getPdfWorkerClient();
      const indices = targetPages.map((p) => p - 1);
      const newBytes = await client.resizePages(bytes, indices, targetSize);
      await applyPdfMutation(newBytes);
      toast.success(`Resized ${targetPages.length} page${targetPages.length === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't resize pages", error instanceof Error ? error.message : undefined);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Resize pages"
      description="Existing content is scaled to fit the new size and centered — never stretched or cropped."
      width={480}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!isValid || isApplying} onClick={() => void handleApply()}>
            {isApplying ? "Resizing…" : `Resize ${targetPages.length} page${targetPages.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          <button
            type="button"
            onClick={() => setScope("all")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${scope === "all" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            All {pageCount} pages
          </button>
          <button
            type="button"
            disabled={selectedPageNumbers.length === 0}
            onClick={() => setScope("selected")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${scope === "selected" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Selected ({selectedPageNumbers.length})
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Target size</span>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPresetKey(key)}
                className={`rounded-[--radius-sm] border px-3 py-2 text-left text-sm transition-colors ${
                  presetKey === key ? "border-primary bg-primary-muted text-text" : "border-border-strong text-text-muted hover:bg-surface-hover"
                }`}
              >
                {STANDARD_PAGE_SIZES[key]!.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPresetKey("custom")}
              className={`rounded-[--radius-sm] border px-3 py-2 text-left text-sm transition-colors ${
                presetKey === "custom" ? "border-primary bg-primary-muted text-text" : "border-border-strong text-text-muted hover:bg-surface-hover"
              }`}
            >
              Custom size
            </button>
          </div>
        </div>

        {presetKey === "custom" && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-text">
              Width
              <input
                type="number"
                min={72}
                value={Math.round(customWidth)}
                onChange={(e) => setCustomWidth(Math.max(72, Number.parseFloat(e.target.value) || 72))}
                className="h-8 w-20 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-right outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
              />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-text">
              Height
              <input
                type="number"
                min={72}
                value={Math.round(customHeight)}
                onChange={(e) => setCustomHeight(Math.max(72, Number.parseFloat(e.target.value) || 72))}
                className="h-8 w-20 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-right outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
              />
            </label>
            <span className="text-xs text-text-faint">pt (72pt = 1 in)</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
