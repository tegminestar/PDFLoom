import type { PdfDocument } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import JSZip from "jszip";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

type ImageFormat = "png" | "jpeg";
type RangeMode = "all" | "current" | "custom";

function parsePageList(input: string, pageCount: number): number[] | null {
  const indices = new Set<number>();
  for (const part of input.split(",").map((p) => p.trim()).filter(Boolean)) {
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1]!, 10);
      const end = Number.parseInt(rangeMatch[2]!, 10);
      if (start < 1 || end > pageCount || start > end) return null;
      for (let p = start; p <= end; p++) indices.add(p);
    } else {
      const n = Number.parseInt(part, 10);
      if (!Number.isFinite(n) || n < 1 || n > pageCount) return null;
      indices.add(n);
    }
  }
  return indices.size > 0 ? [...indices].sort((a, b) => a - b) : null;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderPageToBlob(
  doc: PdfDocument,
  pageNumber: number,
  scale: number,
  format: ImageFormat,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await doc.renderPage(pageNumber, { canvas, scale });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Couldn't encode page ${pageNumber}`))),
      format === "png" ? "image/png" : "image/jpeg",
      format === "jpeg" ? quality : undefined,
    );
  });
}

export function ExportImagesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const currentPage = useLoomStore((s) => s.currentPage);
  const pageCount = meta?.pageCount ?? 0;

  const [format, setFormat] = useState<ImageFormat>("png");
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.85);
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const [customRange, setCustomRange] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const resolvedPages =
    rangeMode === "all"
      ? Array.from({ length: pageCount }, (_, i) => i + 1)
      : rangeMode === "current"
        ? [currentPage]
        : parsePageList(customRange, pageCount);

  const handleExport = async () => {
    if (!doc || !meta || !resolvedPages || resolvedPages.length === 0) return;
    setIsExporting(true);
    setProgress({ done: 0, total: resolvedPages.length });
    try {
      const scale = dpi / 72;
      const baseName = meta.name.replace(/\.pdf$/i, "");
      const ext = format === "png" ? "png" : "jpg";

      if (resolvedPages.length === 1) {
        const blob = await renderPageToBlob(doc, resolvedPages[0]!, scale, format, quality);
        downloadBlob(blob, `${baseName}-page-${resolvedPages[0]}.${ext}`);
      } else {
        const zip = new JSZip();
        for (let i = 0; i < resolvedPages.length; i++) {
          const pageNumber = resolvedPages[i]!;
          const blob = await renderPageToBlob(doc, pageNumber, scale, format, quality);
          zip.file(`${baseName}-page-${pageNumber}.${ext}`, blob);
          setProgress({ done: i + 1, total: resolvedPages.length });
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `${baseName}-pages.zip`);
      }
      toast.success(`Exported ${resolvedPages.length} page${resolvedPages.length === 1 ? "" : "s"} as ${format.toUpperCase()}`);
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't export pages", error instanceof Error ? error.message : undefined);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export pages as images"
      description="Renders each page to a real raster image, right in your browser."
      width={440}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!resolvedPages || isExporting} onClick={() => void handleExport()}>
            {isExporting
              ? progress
                ? `Exporting ${progress.done}/${progress.total}…`
                : "Exporting…"
              : `Export ${resolvedPages?.length ?? "…"} page${resolvedPages?.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          <button
            type="button"
            onClick={() => setFormat("png")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${format === "png" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            PNG
          </button>
          <button
            type="button"
            onClick={() => setFormat("jpeg")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${format === "jpeg" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            JPEG
          </button>
        </div>

        <label className="flex items-center justify-between gap-2 text-sm text-text">
          Resolution
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={72}
              max={600}
              step={1}
              value={dpi}
              onChange={(e) => setDpi(Number.parseInt(e.target.value, 10) || 150)}
              className="h-8 w-16 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-right outline-none"
            />
            <span className="text-xs text-text-faint">DPI</span>
          </div>
        </label>

        {format === "jpeg" && (
          <label className="flex items-center justify-between gap-2 text-sm text-text">
            Quality
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.05}
              value={quality}
              onChange={(e) => setQuality(Number.parseFloat(e.target.value))}
              className="w-40"
            />
            <span className="w-10 text-right text-xs text-text-faint">{Math.round(quality * 100)}%</span>
          </label>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-sm text-text">Pages</span>
          <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
            {(["all", "current", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRangeMode(m)}
                className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${rangeMode === m ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
              >
                {m === "all" ? "All" : m === "current" ? "Current" : "Custom"}
              </button>
            ))}
          </div>
          {rangeMode === "custom" && (
            <input
              value={customRange}
              onChange={(e) => setCustomRange(e.target.value)}
              placeholder={`e.g. 1-3, 5 (1–${pageCount})`}
              className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
            />
          )}
          {rangeMode === "custom" && customRange && !resolvedPages && (
            <p className="text-xs text-danger">Enter page numbers or ranges within 1–{pageCount}, comma-separated.</p>
          )}
        </div>

        {resolvedPages && resolvedPages.length > 1 && (
          <p className="text-xs text-text-faint">Multiple pages are bundled into a single .zip download.</p>
        )}
      </div>
    </Dialog>
  );
}
