import type { PdfDocument } from "@pdfloom/core";
import { Panel, cn } from "@pdfloom/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLoomStore } from "../../app/store";

const THUMB_SCALE = 0.18;

function PageThumbnail({
  doc,
  pageNumber,
  rotation,
  active,
  onSelect,
}: {
  doc: PdfDocument;
  pageNumber: number;
  rotation: 0 | 90 | 180 | 270;
  active: boolean;
  onSelect: () => void;
}) {
  const containerRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<{ widthPt: number; heightPt: number } | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    doc.getPageDimensions(pageNumber).then((d) => {
      if (!cancelled) setDims(d);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && canvasRef.current && !rendered) {
          doc
            .renderPage(pageNumber, { canvas: canvasRef.current, scale: THUMB_SCALE, rotation })
            .then(() => setRendered(true))
            .catch(() => undefined);
        }
      },
      { rootMargin: "400px 0px 400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc, pageNumber, rotation, rendered]);

  // Re-render if rotation changes after an initial render.
  useEffect(() => {
    if (rendered) setRendered(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation]);

  const rotated = rotation === 90 || rotation === 270;
  const widthPt = dims ? (rotated ? dims.heightPt : dims.widthPt) : 612;
  const heightPt = dims ? (rotated ? dims.widthPt : dims.heightPt) : 792;

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col items-center gap-1.5 rounded-[--radius-sm] p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
    >
      <div
        className={cn(
          "flex items-center justify-center bg-canvas shadow-[0_1px_4px_var(--loom-canvas-shadow)]",
          "outline outline-2 -outline-offset-2",
          active ? "outline-primary" : "outline-transparent",
        )}
        style={{ width: widthPt * THUMB_SCALE, height: heightPt * THUMB_SCALE }}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
      <span className={cn("text-[11px] tabular-nums", active ? "font-semibold text-primary" : "text-text-faint")}>
        {pageNumber}
      </span>
    </button>
  );
}

export function ThumbnailsPanel() {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const currentPage = useLoomStore((s) => s.currentPage);
  const setCurrentPage = useLoomStore((s) => s.setCurrentPage);
  const viewRotation = useLoomStore((s) => s.viewRotation);
  const setActivePanel = useLoomStore((s) => s.setActivePanel);

  const pageNumbers = useMemo(
    () => (meta ? Array.from({ length: meta.pageCount }, (_, i) => i + 1) : []),
    [meta],
  );

  if (!doc) return null;

  return (
    <Panel title="Pages" onClose={() => setActivePanel(null)} width={196}>
      <div className="grid grid-cols-2 gap-1">
        {pageNumbers.map((pageNumber) => (
          <PageThumbnail
            key={pageNumber}
            doc={doc}
            pageNumber={pageNumber}
            rotation={viewRotation}
            active={pageNumber === currentPage}
            onSelect={() => setCurrentPage(pageNumber)}
          />
        ))}
      </div>
    </Panel>
  );
}
