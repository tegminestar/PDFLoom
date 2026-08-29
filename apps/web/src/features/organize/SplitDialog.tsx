import { getPdfWorkerClient, type PageRange } from "@pdfloom/core";
import { Button, Dialog, IconButton, toast } from "@pdfloom/ui";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLoomStore } from "../../app/store";

type SplitMode = "everyN" | "custom";

interface RangeRow {
  id: number;
  start: string;
  end: string;
}

let nextRowId = 1;

function computeEveryNRanges(pageCount: number, n: number): PageRange[] {
  const ranges: PageRange[] = [];
  for (let start = 1; start <= pageCount; start += n) {
    ranges.push({ start, end: Math.min(start + n - 1, pageCount) });
  }
  return ranges;
}

export function SplitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const storage = useLoomStore((s) => s.storage);
  const pageCount = meta?.pageCount ?? 0;

  const [mode, setMode] = useState<SplitMode>("everyN");
  const [everyN, setEveryN] = useState(1);
  const [rows, setRows] = useState<RangeRow[]>([{ id: nextRowId++, start: "1", end: String(pageCount || 1) }]);
  const [isSplitting, setIsSplitting] = useState(false);

  useEffect(() => {
    if (open) setRows([{ id: nextRowId++, start: "1", end: String(pageCount || 1) }]);
  }, [open, pageCount]);

  const parsedRanges: PageRange[] | null =
    mode === "everyN"
      ? computeEveryNRanges(pageCount, Math.max(1, everyN))
      : (() => {
          const parsed: PageRange[] = [];
          for (const row of rows) {
            const start = Number.parseInt(row.start, 10);
            const end = Number.parseInt(row.end, 10);
            if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end > pageCount || start > end) {
              return null;
            }
            parsed.push({ start, end });
          }
          return parsed.length > 0 ? parsed : null;
        })();

  const handleSplit = async () => {
    if (!doc || !meta || !parsedRanges) return;
    setIsSplitting(true);
    try {
      const bytes = await doc.getRawBytes();
      const client = await getPdfWorkerClient();
      const outputs = await client.splitDocument(bytes, parsedRanges);
      const baseName = meta.name.replace(/\.pdf$/i, "");
      for (let i = 0; i < outputs.length; i++) {
        const range = parsedRanges[i]!;
        const suffix = range.start === range.end ? `page-${range.start}` : `pages-${range.start}-${range.end}`;
        await storage.save(new Uint8Array(outputs[i]!), `${baseName}-${suffix}.pdf`);
      }
      toast.success(`Split into ${outputs.length} file${outputs.length === 1 ? "" : "s"}`, "Each part downloaded separately.");
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't split the document", error instanceof Error ? error.message : undefined);
    } finally {
      setIsSplitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Split document"
      description={`Split this ${pageCount}-page document into multiple PDFs.`}
      width={480}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!parsedRanges || isSplitting}
            onClick={() => void handleSplit()}
          >
            {isSplitting ? "Splitting…" : `Split into ${parsedRanges?.length ?? "…"} files`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          <button
            type="button"
            onClick={() => setMode("everyN")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${mode === "everyN" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Every N pages
          </button>
          <button
            type="button"
            onClick={() => setMode("custom")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${mode === "custom" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Custom ranges
          </button>
        </div>

        {mode === "everyN" ? (
          <label className="flex items-center gap-2 text-sm text-text">
            Split every
            <input
              type="number"
              min={1}
              max={pageCount}
              value={everyN}
              onChange={(e) => setEveryN(Number.parseInt(e.target.value, 10) || 1)}
              className="h-8 w-16 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
            />
            page{everyN === 1 ? "" : "s"} → {computeEveryNRanges(pageCount, Math.max(1, everyN)).length} files
          </label>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={row.id} className="flex items-center gap-2">
                <span className="w-14 text-xs text-text-faint">Part {i + 1}</span>
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  value={row.start}
                  onChange={(e) =>
                    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, start: e.target.value } : r)))
                  }
                  className="h-8 w-16 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-center outline-none"
                />
                <span className="text-text-faint">to</span>
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  value={row.end}
                  onChange={(e) =>
                    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, end: e.target.value } : r)))
                  }
                  className="h-8 w-16 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-center outline-none"
                />
                <IconButton
                  icon={<Trash2 />}
                  label="Remove this range"
                  size="sm"
                  disabled={rows.length === 1}
                  onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                />
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRows((prev) => [...prev, { id: nextRowId++, start: "1", end: String(pageCount || 1) }])}
            >
              <Plus className="h-4 w-4" />
              Add range
            </Button>
            {!parsedRanges && (
              <p className="text-xs text-danger">
                Each range needs a valid start ≤ end within 1–{pageCount}.
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
