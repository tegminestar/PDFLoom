import { getPdfWorkerClient, PdfDocument } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import JSZip from "jszip";
import { FileText, X } from "lucide-react";
import { useRef, useState } from "react";

type Operation = "compress" | "watermark";

const QUALITY_PRESETS = [
  { id: "high", label: "High quality", dpi: 200, jpegQuality: 0.85 },
  { id: "balanced", label: "Balanced", dpi: 150, jpegQuality: 0.7 },
  { id: "small", label: "Smallest file", dpi: 100, jpegQuality: 0.5 },
] as const;

/**
 * Runs one operation across many files at once, entirely client-side — each
 * file is processed independently with the exact same on-device functions
 * the single-file Compress/Watermark dialogs use, then everything is zipped
 * for one download. No file is ever combined with another or uploaded.
 */
export function BatchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [operation, setOperation] = useState<Operation>("compress");
  const [preset, setPreset] = useState<(typeof QUALITY_PRESETS)[number]["id"]>("balanced");
  const [watermarkText, setWatermarkText] = useState("DRAFT");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const pdfs = Array.from(picked).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    setFiles((prev) => [...prev, ...pdfs]);
  };
  const removeFile = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) setFiles([]);
    onOpenChange(nextOpen);
  };

  const handleRun = async () => {
    if (files.length === 0) {
      toast.warning("Add at least one PDF first");
      return;
    }
    setIsRunning(true);
    setProgress({ done: 0, total: files.length });
    try {
      const client = await getPdfWorkerClient();
      const zip = new JSZip();
      const selected = QUALITY_PRESETS.find((p) => p.id === preset)!;
      // Files from different folders can easily share a name (several
      // "invoice.pdf"s is the common case) — a raw name collision in the
      // zip would silently overwrite one result with another.
      const usedNames = new Set<string>();

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const bytes = new Uint8Array(await file.arrayBuffer());
        let outBytes: Uint8Array;

        if (operation === "watermark") {
          outBytes = await client.addTextWatermark(bytes, { text: watermarkText || "DRAFT", layout: "tile", opacity: 0.2 });
        } else {
          const doc = await PdfDocument.load(bytes);
          const scale = selected.dpi / 72;
          const pages: { widthPt: number; heightPt: number; jpegBytes: Uint8Array }[] = [];
          for (let pageNumber = 1; pageNumber <= doc.pageCount; pageNumber++) {
            const dims = await doc.getPageDimensions(pageNumber);
            const canvas = document.createElement("canvas");
            await doc.renderPage(pageNumber, { canvas, scale });
            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode a page"))), "image/jpeg", selected.jpegQuality);
            });
            pages.push({ widthPt: dims.widthPt, heightPt: dims.heightPt, jpegBytes: new Uint8Array(await blob.arrayBuffer()) });
          }
          doc.destroy();
          outBytes = await client.rebuildFromPageImages(pages);
        }

        const baseName = file.name.replace(/\.pdf$/i, "") + (operation === "compress" ? "-compressed" : "-watermarked");
        let outName = `${baseName}.pdf`;
        let dedupeCount = 2;
        while (usedNames.has(outName)) {
          outName = `${baseName} (${dedupeCount}).pdf`;
          dedupeCount += 1;
        }
        usedNames.add(outName);
        zip.file(outName, outBytes);
        setProgress({ done: i + 1, total: files.length });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pdfloom-batch-${operation}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success("Batch complete", `${files.length} file${files.length === 1 ? "" : "s"} processed and downloaded as a zip.`);
      handleClose(false);
    } catch (error) {
      toast.error("Couldn't complete the batch", error instanceof Error ? error.message : undefined);
    } finally {
      setIsRunning(false);
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title="Batch process files"
      description="Run one operation across many PDFs at once — entirely on your device, downloaded as a single zip."
      width={480}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => handleClose(false)} disabled={isRunning}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={isRunning || files.length === 0} onClick={() => void handleRun()}>
            {isRunning ? (progress ? `Processing ${progress.done}/${progress.total}…` : "Processing…") : `Run on ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          {(["compress", "watermark"] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => setOperation(op)}
              className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium capitalize transition-colors ${operation === op ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
            >
              {op}
            </button>
          ))}
        </div>

        {operation === "compress" ? (
          <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
            {QUALITY_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`flex-1 rounded-[--radius-sm] py-1.5 text-xs font-medium transition-colors ${preset === p.id ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <input
            type="text"
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            placeholder="Watermark text"
            className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
          />
        )}

        <div className="flex flex-col gap-2">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-2 rounded-[--radius-sm] border border-border-strong bg-surface p-2">
              <FileText className="h-4 w-4 shrink-0 text-text-faint" />
              <span className="flex-1 truncate text-sm text-text">{file.name}</span>
              <button type="button" onClick={() => removeFile(i)} className="text-text-faint hover:text-text">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="self-start">
            Add PDFs…
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}
