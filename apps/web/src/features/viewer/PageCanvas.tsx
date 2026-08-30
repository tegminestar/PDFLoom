import type { PdfDocument, TextLayer } from "@pdfloom/core";
import { useEffect, useRef, useState } from "react";
import { AnnotationDrawOverlay } from "../annotate/AnnotationDrawOverlay";
import { EditOverlay } from "../edit/EditOverlay";
import { FieldDesignerOverlay } from "../forms/FieldDesignerOverlay";
import { FormFieldOverlay } from "../forms/FormFieldOverlay";
import { RedactOverlay } from "../protect/RedactOverlay";

export interface PageCanvasProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  isActiveSearchResult: boolean;
}

/**
 * Renders one PDF page. Dimensions are fetched immediately on mount (cheap
 * metadata reads, needed for accurate scroll-height layout); actual pixel
 * rendering to canvas is gated behind IntersectionObserver so a long
 * document doesn't rasterize every page at once. This visibility is purely
 * a render-gating concern local to this component — "which page is the
 * user currently reading" is tracked separately by the Viewer via scroll
 * geometry (see Viewer.tsx), which is synchronous and doesn't race with
 * this observer's own eventual-consistency timing.
 */
export function PageCanvas({ doc, pageNumber, scale, rotation, isActiveSearchResult }: PageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ widthPt: number; heightPt: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasRendered, setHasRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    doc.getPageDimensions(pageNumber).then((dims) => {
      if (!cancelled) setDimensions(dims);
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
        setIsVisible(entry?.isIntersecting ?? false);
      },
      { rootMargin: "1000px 0px 1000px 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  useEffect(() => {
    if (!isVisible || !canvasRef.current) return;
    let cancelled = false;
    doc
      .renderPage(pageNumber, { canvas: canvasRef.current, scale, rotation })
      .then(() => {
        if (!cancelled) setHasRendered(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error(`Failed to render page ${pageNumber}`, error);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, scale, rotation, isVisible]);

  // Real text selection — renders positioned, invisible text spans over the
  // canvas via pdf.js's TextLayer, aligned to the same scale/rotation.
  useEffect(() => {
    if (!isVisible || !textLayerRef.current) return;
    const container = textLayerRef.current;
    container.replaceChildren();
    let cancelled = false;
    let layer: TextLayer | undefined;
    doc
      .renderTextLayer(pageNumber, { container, scale, rotation })
      .then((l) => {
        if (cancelled) l.cancel();
        else layer = l;
      })
      .catch((error: unknown) => console.error(`Failed to render text layer for page ${pageNumber}`, error));
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [doc, pageNumber, scale, rotation, isVisible]);

  const rotated = rotation === 90 || rotation === 270;
  const widthPt = dimensions ? (rotated ? dimensions.heightPt : dimensions.widthPt) : 612;
  const heightPt = dimensions ? (rotated ? dimensions.widthPt : dimensions.heightPt) : 792;

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      className="relative mx-auto flex items-center justify-center"
      style={{ width: widthPt * scale, height: heightPt * scale }}
    >
      <div
        ref={pageRef}
        className="relative bg-canvas shadow-[0_1px_2px_var(--loom-canvas-shadow),0_18px_36px_-12px_var(--loom-canvas-shadow)]"
        style={{ width: widthPt * scale, height: heightPt * scale }}
      >
        {isVisible && <canvas ref={canvasRef} className="block" />}
        {isVisible && <div ref={textLayerRef} className="loom-text-layer" />}
        {isVisible && <AnnotationDrawOverlay doc={doc} pageNumber={pageNumber} scale={scale} rotation={rotation} />}
        {isVisible && <FormFieldOverlay doc={doc} pageNumber={pageNumber} scale={scale} rotation={rotation} />}
        {isVisible && <FieldDesignerOverlay doc={doc} pageNumber={pageNumber} scale={scale} rotation={rotation} />}
        {isVisible && <EditOverlay doc={doc} pageNumber={pageNumber} scale={scale} rotation={rotation} pageContainerRef={pageRef} />}
        {isVisible && <RedactOverlay doc={doc} pageNumber={pageNumber} scale={scale} rotation={rotation} />}
      </div>
      {!hasRendered && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-text-faint">
          {pageNumber}
        </div>
      )}
      {isActiveSearchResult && (
        <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-ai" />
      )}
    </div>
  );
}
