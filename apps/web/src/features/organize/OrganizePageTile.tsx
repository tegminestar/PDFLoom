import type { PdfDocument } from "@pdfloom/core";
import { cn } from "@pdfloom/ui";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { DropEdge } from "./reorder";

export type { DropEdge };

const TILE_SCALE = 0.32;

export interface OrganizePageTileProps {
  doc: PdfDocument;
  pageNumber: number;
  selected: boolean;
  onToggleSelect: (pageNumber: number, event: MouseEvent) => void;
  onDragStart: (pageNumber: number) => void;
  onDragOverTile: (pageNumber: number, edge: DropEdge) => void;
  onDrop: (pageNumber: number, edge: DropEdge) => void;
  /** Which edge to show the insertion-line indicator on, or null if this tile isn't the current drop target. */
  dropEdge: DropEdge | null;
  isDragging: boolean;
}

export function OrganizePageTile({
  doc,
  pageNumber,
  selected,
  onToggleSelect,
  onDragStart,
  onDragOverTile,
  onDrop,
  dropEdge,
  isDragging,
}: OrganizePageTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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
    if (!el || !dims) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && canvasRef.current) {
          doc
            .renderPage(pageNumber, { canvas: canvasRef.current, scale: TILE_SCALE })
            .then(() => setRendered(true))
            .catch(() => undefined);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px 600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc, pageNumber, dims]);

  // getPageDimensions already returns rotation-corrected width/height
  // (pdf.js's getViewport bakes the page's own stored rotation into the
  // reported size), so no separate rotation handling is needed here.
  const widthPt = dims?.widthPt ?? 300;
  const heightPt = dims?.heightPt ?? 400;

  return (
    <div
      ref={containerRef}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(pageNumber);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        // Which half of this tile the cursor is over decides insert-before
        // vs insert-after — a single "this tile is the target" highlight is
        // ambiguous about which side the dragged page lands on (and, worse,
        // made the actual drop position depend on drag direction). An
        // explicit edge, shown as a line rather than a tile-wide highlight,
        // removes both problems.
        const rect = e.currentTarget.getBoundingClientRect();
        const edge: DropEdge = e.clientX - rect.left < rect.width / 2 ? "before" : "after";
        onDragOverTile(pageNumber, edge);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const edge: DropEdge = e.clientX - rect.left < rect.width / 2 ? "before" : "after";
        onDrop(pageNumber, edge);
      }}
      onClick={(e) => onToggleSelect(pageNumber, e)}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-[--radius-md] border-2 p-3 transition-colors",
        selected ? "border-primary bg-primary-muted" : "border-transparent hover:bg-surface-hover",
        isDragging && "opacity-40",
      )}
    >
      {dropEdge && (
        <div
          className={cn(
            "pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-ai",
            dropEdge === "before" ? "-left-0.5" : "-right-0.5",
          )}
        />
      )}
      <div
        className="flex items-center justify-center bg-canvas shadow-[0_1px_4px_var(--loom-canvas-shadow)]"
        style={{ width: widthPt * TILE_SCALE, height: heightPt * TILE_SCALE }}
      >
        {dims && <canvas ref={canvasRef} className="block" />}
        {!rendered && <div className="text-xs text-text-faint">{pageNumber}</div>}
      </div>
      <span className={cn("text-xs tabular-nums", selected ? "font-semibold text-primary" : "text-text-muted")}>
        {pageNumber}
      </span>
      <div
        className={cn(
          "absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-bg-elevated transition-opacity",
          selected ? "border-primary opacity-100" : "border-border-strong opacity-0 group-hover:opacity-100",
        )}
      >
        {selected && <CheckCircle2 className="h-4 w-4 text-primary" fill="currentColor" />}
      </div>
    </div>
  );
}
