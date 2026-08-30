import { getPdfWorkerClient, recognizeImage, type OcrLanguage } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

type RangeMode = "all" | "current" | "custom";

const LANGUAGES: { id: OcrLanguage; label: string }[] = [
  { id: "eng", label: "English" },
  { id: "spa", label: "Spanish" },
  { id: "fra", label: "French" },
  { id: "deu", label: "German" },
  { id: "por", label: "Portuguese" },
  { id: "ita", label: "Italian" },
];

const OCR_DPI = 250;

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

/**
 * Makes scanned pages searchable: rasterizes each page (needs a real
 * <canvas>, so this happens here in the UI, not the pdf-lib worker),
 * recognizes it with Tesseract.js (which runs its own dedicated worker —
 * called directly from the main thread rather than nested inside our pdf
 * worker), then bakes every recognized word onto the page as invisible,
 * position-matched text via the worker's addInvisibleTextLayer. Once that
 * lands, the document's existing text layer/search "just work" on the
 * OCR'd pages — no separate search code path needed.
 */
export function OcrDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const currentPage = useLoomStore((s) => s.currentPage);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);
  const pageCount = meta?.pageCount ?? 0;

  const [lang, setLang] = useState<OcrLanguage>("eng");
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const [customRange, setCustomRange] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{ pages: number; words: number } | null>(null);

  const resolvedPages =
    rangeMode === "all"
      ? Array.from({ length: pageCount }, (_, i) => i + 1)
      : rangeMode === "current"
        ? [currentPage]
        : parsePageList(customRange, pageCount);

  const handleRun = async () => {
    if (!doc || !meta || !resolvedPages || resolvedPages.length === 0) return;
    setIsRunning(true);
    setResult(null);
    try {
      const client = await getPdfWorkerClient();
      let bytes = await doc.getRawBytes();
      const scale = OCR_DPI / 72;
      let totalWords = 0;

      for (let i = 0; i < resolvedPages.length; i++) {
        const pageNumber = resolvedPages[i]!;
        setStatus(`Page ${i + 1}/${resolvedPages.length}: rendering…`);
        const dims = await doc.getPageDimensions(pageNumber);
        const canvas = document.createElement("canvas");
        await doc.renderPage(pageNumber, { canvas, scale });
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Couldn't rasterize page ${pageNumber}`))), "image/png");
        });

        const words = await recognizeImage(blob, lang, (p) => setStatus(`Page ${i + 1}/${resolvedPages.length}: ${p.status} ${Math.round(p.progress * 100)}%`));
        totalWords += words.length;

        const placements = words
          .filter((w) => w.text.trim().length > 0)
          .map((w) => ({
            text: w.text,
            rect: {
              x: w.bbox.x0 / scale,
              y: dims.heightPt - w.bbox.y1 / scale,
              width: (w.bbox.x1 - w.bbox.x0) / scale,
              height: (w.bbox.y1 - w.bbox.y0) / scale,
            },
          }));

        if (placements.length > 0) {
          bytes = await client.addInvisibleTextLayer(bytes, pageNumber - 1, placements);
        }
      }

      await applyPdfMutation(bytes);
      setResult({ pages: resolvedPages.length, words: totalWords });
      toast.success(`Made ${resolvedPages.length} page${resolvedPages.length === 1 ? "" : "s"} searchable`, `Recognized ${totalWords} words.`);
    } catch (error) {
      toast.error("Couldn't run OCR", error instanceof Error ? error.message : undefined);
    } finally {
      setIsRunning(false);
      setStatus(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Make searchable (OCR)"
      description="Recognizes text in scanned pages and adds it as an invisible, searchable layer — fully local, no upload."
      width={440}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isRunning}>
            {result ? "Close" : "Cancel"}
          </Button>
          <Button variant="primary" size="sm" disabled={!resolvedPages || isRunning} onClick={() => void handleRun()}>
            {isRunning ? "Running…" : `Run OCR on ${resolvedPages?.length ?? "…"} page${resolvedPages?.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex items-center justify-between gap-2 text-sm text-text">
          Language
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as OcrLanguage)}
            disabled={isRunning}
            className="h-8 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-sm text-text outline-none"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-text-faint">
          The language model downloads once (a few MB) and is cached for offline reuse afterward.
        </p>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-text">Pages</span>
          <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
            {(["all", "current", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRangeMode(m)}
                disabled={isRunning}
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
              disabled={isRunning}
              className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
            />
          )}
        </div>

        {status && <p className="text-xs text-text-faint">{status}</p>}
        {result && (
          <p className="text-sm text-text">
            Recognized <span className="font-medium text-primary">{result.words}</span> words across{" "}
            <span className="font-medium">{result.pages}</span> page{result.pages === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </Dialog>
  );
}
