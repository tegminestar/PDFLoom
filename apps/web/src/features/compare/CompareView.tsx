import { diffPageText, diffPixelsRgba, summarizeTextComparison, type ComparisonSummary, type PageTextDiffResult } from "@pdfloom/core";
import { IconButton, cn } from "@pdfloom/ui";
import { ChevronLeft, ChevronRight, FileUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLoomStore, type CompareTarget } from "../../app/store";

const VISUAL_TARGET_WIDTH_PX = 640;

export function CompareView({
  target,
  onClose,
  onChooseDifferentFile,
}: {
  target: CompareTarget;
  onClose: () => void;
  onChooseDifferentFile: () => void;
}) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const { doc: compareDoc, name: compareName } = target;

  const [pageIndex, setPageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"text" | "visual">("text");

  const [summary, setSummary] = useState<ComparisonSummary | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);

  const pageCountA = meta?.pageCount ?? 0;
  const pageCountB = compareDoc.pageCount;
  const pageCount = Math.max(pageCountA, pageCountB);
  const pageNumber = pageIndex + 1;
  const existsInA = pageNumber <= pageCountA;
  const existsInB = pageNumber <= pageCountB;

  // Whole-document changed/unchanged summary, computed once up front so the
  // page-navigation strip can show every page's status without the user
  // having to visit each one first.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setIsSummaryLoading(true);
    (async () => {
      const textsA: string[] = [];
      for (let i = 1; i <= pageCountA; i++) textsA.push(await doc.getFullPageText(i));
      const textsB: string[] = [];
      for (let i = 1; i <= pageCountB; i++) textsB.push(await compareDoc.getFullPageText(i));
      if (cancelled) return;
      setSummary(summarizeTextComparison(textsA, textsB));
      setIsSummaryLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // pageCountA/B come from meta/compareDoc, which only change when a genuinely different document is being compared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, compareDoc]);

  const [pageDiff, setPageDiff] = useState<PageTextDiffResult | null>(null);
  const [isPageDiffLoading, setIsPageDiffLoading] = useState(false);

  useEffect(() => {
    if (!doc || viewMode !== "text" || !existsInA || !existsInB) {
      setPageDiff(null);
      return;
    }
    let cancelled = false;
    setIsPageDiffLoading(true);
    (async () => {
      const [textA, textB] = await Promise.all([doc.getFullPageText(pageNumber), compareDoc.getFullPageText(pageNumber)]);
      if (cancelled) return;
      setPageDiff(diffPageText(textA, textB));
      setIsPageDiffLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, compareDoc, pageNumber, existsInA, existsInB, viewMode]);

  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [visualStats, setVisualStats] = useState<{ changedRatio: number } | null>(null);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [isVisualLoading, setIsVisualLoading] = useState(false);

  useEffect(() => {
    if (!doc || viewMode !== "visual" || !existsInA || !existsInB) {
      setVisualStats(null);
      setVisualError(null);
      return;
    }
    const canvasA = canvasARef.current;
    const canvasB = canvasBRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!canvasA || !canvasB || !overlayCanvas) return;

    let cancelled = false;
    setIsVisualLoading(true);
    setVisualError(null);
    setVisualStats(null);

    (async () => {
      const [dimsA, dimsB] = await Promise.all([doc.getPageDimensions(pageNumber), compareDoc.getPageDimensions(pageNumber)]);
      const scaleA = VISUAL_TARGET_WIDTH_PX / dimsA.widthPt;
      const scaleB = VISUAL_TARGET_WIDTH_PX / dimsB.widthPt;
      await Promise.all([
        doc.renderPage(pageNumber, { canvas: canvasA, scale: scaleA, devicePixelRatio: 1 }),
        compareDoc.renderPage(pageNumber, { canvas: canvasB, scale: scaleB, devicePixelRatio: 1 }),
      ]);
      if (cancelled) return;

      const wDiff = Math.abs(canvasA.width - canvasB.width);
      const hDiff = Math.abs(canvasA.height - canvasB.height);
      if (wDiff > 2 || hDiff > 2) {
        setVisualError("This page's dimensions differ between the two documents, so a pixel overlay isn't meaningful here — compare the two renders below instead.");
        setIsVisualLoading(false);
        return;
      }

      // Tolerate a 1-2px rounding mismatch by cropping both to their common size.
      const width = Math.min(canvasA.width, canvasB.width);
      const height = Math.min(canvasA.height, canvasB.height);
      const ctxA = canvasA.getContext("2d");
      const ctxB = canvasB.getContext("2d");
      if (!ctxA || !ctxB) return;
      const imgA = ctxA.getImageData(0, 0, width, height);
      const imgB = ctxB.getImageData(0, 0, width, height);
      const result = diffPixelsRgba(imgA.data, imgB.data, width, height);

      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const ctxOverlay = overlayCanvas.getContext("2d");
      if (!ctxOverlay) return;
      ctxOverlay.putImageData(new ImageData(new Uint8ClampedArray(result.overlay), width, height), 0, 0);

      if (cancelled) return;
      setVisualStats({ changedRatio: result.changedRatio });
      setIsVisualLoading(false);
    })().catch((error: unknown) => {
      if (!cancelled) {
        setVisualError(error instanceof Error ? error.message : "Couldn't render a visual comparison for this page.");
        setIsVisualLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [doc, compareDoc, pageNumber, existsInA, existsInB, viewMode]);

  if (!doc || !meta) return null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="truncate font-medium text-text">{meta.name}</span>
          <span className="text-text-faint">vs.</span>
          <span className="truncate text-text-muted">{compareName}</span>
        </div>
        <button
          type="button"
          onClick={onChooseDifferentFile}
          className="flex items-center gap-1.5 rounded-[--radius-sm] px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <FileUp className="h-3.5 w-3.5" />
          Change file
        </button>
        <div className="flex gap-1 rounded-[--radius-sm] bg-bg p-1">
          <button
            type="button"
            onClick={() => setViewMode("text")}
            className={cn(
              "rounded-[--radius-sm] px-2.5 py-1 text-xs font-medium transition-colors",
              viewMode === "text" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text",
            )}
          >
            Text
          </button>
          <button
            type="button"
            onClick={() => setViewMode("visual")}
            className={cn(
              "rounded-[--radius-sm] px-2.5 py-1 text-xs font-medium transition-colors",
              viewMode === "visual" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text",
            )}
          >
            Visual
          </button>
        </div>
        <IconButton icon={<X />} label="Close comparison" size="sm" onClick={onClose} />
      </div>

      <div className="border-b border-border bg-surface px-4 py-2">
        <div className="mb-1.5 text-xs text-text-faint">
          {isSummaryLoading
            ? "Comparing pages…"
            : summary
              ? `${summary.changedPageCount} of ${pageCount} page${pageCount === 1 ? "" : "s"} differ`
              : null}
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            icon={<ChevronLeft />}
            label="Previous page"
            size="sm"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
          />
          <div className="flex gap-1 overflow-x-auto py-0.5" style={{ scrollbarWidth: "thin" }}>
            {summary?.pages.map((p) => (
              <button
                key={p.pageIndex}
                type="button"
                title={`Page ${p.pageIndex + 1}${p.textChanged ? " — differs" : " — unchanged"}`}
                onClick={() => setPageIndex(p.pageIndex)}
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[--radius-sm] text-[10px] font-medium tabular-nums outline outline-2 -outline-offset-2",
                  p.pageIndex === pageIndex ? "outline-primary" : "outline-transparent",
                  p.textChanged ? "bg-danger-muted text-danger" : "bg-surface-hover text-text-faint",
                )}
              >
                {p.pageIndex + 1}
              </button>
            ))}
          </div>
          <IconButton
            icon={<ChevronRight />}
            label="Next page"
            size="sm"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
          />
          <span className="shrink-0 text-xs tabular-nums text-text-faint">
            Page {pageNumber} / {pageCount}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {!existsInA || !existsInB ? (
          <p className="mx-auto max-w-lg text-center text-sm text-text-muted">
            {!existsInA
              ? `Page ${pageNumber} doesn't exist in "${meta.name}" — it was added in "${compareName}".`
              : `Page ${pageNumber} doesn't exist in "${compareName}" — it was removed from "${meta.name}".`}
          </p>
        ) : viewMode === "text" ? (
          <div className="mx-auto max-w-3xl">
            {isPageDiffLoading ? (
              <p className="text-sm text-text-faint">Comparing page {pageNumber}…</p>
            ) : pageDiff && pageDiff.ops.length === 0 ? (
              <p className="text-sm text-text-faint">This page has no extractable text.</p>
            ) : pageDiff && !pageDiff.changed ? (
              <p className="text-sm text-text-faint">No text differences on this page.</p>
            ) : pageDiff ? (
              <>
                {pageDiff.truncated && (
                  <p className="mb-3 text-xs text-text-faint">
                    This page has a lot of text — showing that it changed, not exactly where (word-by-word comparison was skipped for this one page).
                  </p>
                )}
                <div className="whitespace-pre-wrap rounded-[--radius-md] border border-border bg-surface p-4 text-sm leading-relaxed text-text">
                  {pageDiff.ops.map((op, i) => (
                    <span
                      key={i}
                      className={
                        op.type === "insert"
                          ? "bg-success/20 text-success"
                          : op.type === "delete"
                            ? "bg-danger-muted text-danger line-through"
                            : undefined
                      }
                    >
                      {op.text}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {visualError && <p className="max-w-lg text-center text-sm text-text-muted">{visualError}</p>}
            {isVisualLoading && <p className="text-sm text-text-faint">Rendering page {pageNumber}…</p>}
            {visualStats && (
              <p className="text-sm text-text-muted">
                {visualStats.changedRatio === 0
                  ? "No visual differences on this page."
                  : `${(visualStats.changedRatio * 100).toFixed(1)}% of this page's pixels differ (highlighted in red).`}
              </p>
            )}
            <canvas ref={overlayCanvasRef} className={cn("max-w-full rounded-[--radius-md] border border-border shadow-[0_1px_8px_var(--loom-canvas-shadow)]", visualError && "hidden")} />
            <div className="flex flex-wrap items-start justify-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs text-text-faint">{meta.name}</span>
                <canvas ref={canvasARef} className="max-w-[280px] rounded-[--radius-sm] border border-border" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs text-text-faint">{compareName}</span>
                <canvas ref={canvasBRef} className="max-w-[280px] rounded-[--radius-sm] border border-border" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
