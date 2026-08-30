import { getPdfWorkerClient } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

const QUALITY_PRESETS = [
  { id: "high", label: "High quality", dpi: 200, jpegQuality: 0.85 },
  { id: "balanced", label: "Balanced", dpi: 150, jpegQuality: 0.7 },
  { id: "small", label: "Smallest file", dpi: 100, jpegQuality: 0.5 },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

/**
 * Image-recompression "Compress" tool: rasterizes every page to a JPEG at a
 * chosen DPI/quality and rebuilds the PDF from those images. This is the
 * technique real PDF compressors use for scanned/image-heavy documents to
 * get large size reductions — it's lossy and pages stop being
 * selectable/searchable text afterward, so this is opt-in and the dialog
 * says so plainly rather than presenting it as a safe default. (Lossless
 * structural compression already happens on every save via pdf-lib's
 * useObjectStreams default, so there's no separate tool for that.)
 */
export function CompressDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [preset, setPreset] = useState<(typeof QUALITY_PRESETS)[number]["id"]>("balanced");
  const [isCompressing, setIsCompressing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ before: number; after: number } | null>(null);

  const selected = QUALITY_PRESETS.find((p) => p.id === preset)!;

  const handleCompress = async () => {
    if (!doc || !meta) return;
    setIsCompressing(true);
    setResult(null);
    try {
      const originalBytes = await doc.getRawBytes();
      const scale = selected.dpi / 72;
      const pages: { widthPt: number; heightPt: number; jpegBytes: Uint8Array }[] = [];
      setProgress({ done: 0, total: meta.pageCount });

      for (let pageNumber = 1; pageNumber <= meta.pageCount; pageNumber++) {
        const dims = await doc.getPageDimensions(pageNumber);
        const canvas = document.createElement("canvas");
        await doc.renderPage(pageNumber, { canvas, scale });
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Couldn't encode page ${pageNumber}`))), "image/jpeg", selected.jpegQuality);
        });
        pages.push({ widthPt: dims.widthPt, heightPt: dims.heightPt, jpegBytes: new Uint8Array(await blob.arrayBuffer()) });
        setProgress({ done: pageNumber, total: meta.pageCount });
      }

      const client = await getPdfWorkerClient();
      const compressed = await client.rebuildFromPageImages(pages);
      setResult({ before: originalBytes.length, after: compressed.length });
      await applyPdfMutation(compressed);
      toast.success(
        compressed.length < originalBytes.length ? "Compressed" : "Rebuilt",
        `${formatBytes(originalBytes.length)} → ${formatBytes(compressed.length)}`,
      );
    } catch (error) {
      toast.error("Couldn't compress this document", error instanceof Error ? error.message : undefined);
    } finally {
      setIsCompressing(false);
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Compress"
      description="Re-renders every page as a compressed image — best for scanned or image-heavy PDFs."
      width={440}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isCompressing}>
            {result ? "Close" : "Cancel"}
          </Button>
          <Button variant="primary" size="sm" disabled={isCompressing} onClick={() => void handleCompress()}>
            {isCompressing ? (progress ? `Compressing ${progress.done}/${progress.total}…` : "Compressing…") : "Compress"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          {QUALITY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${preset === p.id ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <p className="rounded-[--radius-sm] border border-border bg-bg-elevated/60 p-3 text-xs leading-relaxed text-text-faint">
          This rebuilds every page as a flattened image. Text will no longer be selectable, searchable, or
          copyable afterward — best suited for scanned documents or pages that are already mostly images.
        </p>

        {result && (
          <p className="text-sm text-text">
            <span className="font-medium">{formatBytes(result.before)}</span> →{" "}
            <span className="font-medium text-primary">{formatBytes(result.after)}</span>{" "}
            <span className="text-text-faint">
              ({result.after < result.before ? `${Math.round((1 - result.after / result.before) * 100)}% smaller` : "no size reduction"})
            </span>
          </p>
        )}
      </div>
    </Dialog>
  );
}
