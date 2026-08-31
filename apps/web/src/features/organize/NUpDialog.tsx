import { getPdfWorkerClient, STANDARD_PAGE_SIZES, type PageSize } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

const LAYOUTS: { columns: number; rows: number; label: string }[] = [
  { columns: 2, rows: 1, label: "2 per sheet" },
  { columns: 2, rows: 2, label: "4 per sheet" },
  { columns: 3, rows: 2, label: "6 per sheet" },
  { columns: 3, rows: 3, label: "9 per sheet" },
];

export function NUpDialog({
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
  const storage = useLoomStore((s) => s.storage);
  const pageCount = meta?.pageCount ?? 0;

  const [scope, setScope] = useState<"all" | "selected">(selectedPageNumbers.length > 0 ? "selected" : "all");
  const [layoutIndex, setLayoutIndex] = useState(1); // default 4-per-sheet, matches Acrobat/most printers' default
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  const [isApplying, setIsApplying] = useState(false);

  const layout = LAYOUTS[layoutIndex]!;
  const letter = STANDARD_PAGE_SIZES["letter"]!.size;
  const sheetSize: PageSize = orientation === "landscape" ? { width: letter.height, height: letter.width } : letter;

  const targetPages = scope === "selected" && selectedPageNumbers.length > 0 ? selectedPageNumbers : Array.from({ length: pageCount }, (_, i) => i + 1);
  const sheetsProduced = Math.ceil(targetPages.length / (layout.columns * layout.rows));
  const isValid = targetPages.length > 0;

  const handleApply = async () => {
    if (!doc || !meta || !isValid) return;
    setIsApplying(true);
    try {
      const bytes = await doc.getRawBytes();
      const client = await getPdfWorkerClient();
      const indices = targetPages.map((p) => p - 1);
      const out = await client.nUpPages(bytes, indices, { columns: layout.columns, rows: layout.rows, sheetSize });
      const baseName = meta.name.replace(/\.pdf$/i, "");
      await storage.saveAs(new Uint8Array(out), `${baseName}-${layout.columns * layout.rows}-up.pdf`);
      toast.success(`Combined ${targetPages.length} pages onto ${sheetsProduced} sheet${sheetsProduced === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (error) {
      // Cancelling the native save dialog is a normal, expected action —
      // not a failure worth an error toast (saveAs throws AbortError for
      // it rather than resolving, specifically so this is distinguishable
      // from every other kind of failure).
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Couldn't combine pages", error instanceof Error ? error.message : undefined);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Multiple pages per sheet"
      description="Combines several pages onto fewer, larger sheets — saved as a new file, the open document stays as-is."
      width={480}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!isValid || isApplying} onClick={() => void handleApply()}>
            {isApplying ? "Combining…" : `Save ${sheetsProduced} sheet${sheetsProduced === 1 ? "" : "s"}`}
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
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Layout</span>
          <div className="grid grid-cols-4 gap-1.5">
            {LAYOUTS.map((l, i) => (
              <button
                key={l.label}
                type="button"
                onClick={() => setLayoutIndex(i)}
                className={`rounded-[--radius-sm] border px-2 py-2 text-center text-sm transition-colors ${
                  layoutIndex === i ? "border-primary bg-primary-muted text-text" : "border-border-strong text-text-muted hover:bg-surface-hover"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Sheet orientation</span>
          <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
            <button
              type="button"
              onClick={() => setOrientation("landscape")}
              className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${orientation === "landscape" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
            >
              Landscape
            </button>
            <button
              type="button"
              onClick={() => setOrientation("portrait")}
              className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${orientation === "portrait" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
            >
              Portrait
            </button>
          </div>
        </div>

        <p className="text-xs text-text-faint">
          {targetPages.length} page{targetPages.length === 1 ? "" : "s"} → {sheetsProduced} US Letter sheet{sheetsProduced === 1 ? "" : "s"}, {layout.label.toLowerCase()}.
        </p>
      </div>
    </Dialog>
  );
}
