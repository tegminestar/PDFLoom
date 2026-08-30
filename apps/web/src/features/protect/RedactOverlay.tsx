import type { PdfDocument } from "@pdfloom/core";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLoomStore } from "../../app/store";

export interface RedactOverlayProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
}

interface ScreenPoint {
  x: number;
  y: number;
}
interface ScreenRect extends ScreenPoint {
  width: number;
  height: number;
}

/**
 * Draws pending redaction boxes across any page — they aren't applied
 * until RedactToolbar's "Apply redactions" runs (which rasterizes every
 * affected page and burns the boxes in for real, see redact.ts), so this
 * overlay is purely about marking *where*, not doing the actual redaction.
 */
export function RedactOverlay({ doc, pageNumber, scale, rotation }: RedactOverlayProps) {
  const redactOpen = useLoomStore((s) => s.redactOpen);
  const redactBoxes = useLoomStore((s) => s.redactBoxes);
  const addRedactBox = useLoomStore((s) => s.addRedactBox);
  const removeRedactBox = useLoomStore((s) => s.removeRedactBox);

  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<ScreenPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<ScreenPoint | null>(null);
  const [screenBoxes, setScreenBoxes] = useState<{ index: number; rect: ScreenRect }[]>([]);

  const pageIndex = pageNumber - 1;
  const boxesOnPage = redactBoxes.map((box, index) => ({ box, index })).filter(({ box }) => box.pageIndex === pageIndex);
  const boxesKey = boxesOnPage.map(({ index, box }) => `${index}:${box.rect.x},${box.rect.y},${box.rect.width},${box.rect.height}`).join("|");

  // Keep this page's boxes positioned in screen space, recomputed whenever
  // the set of boxes on this page (or the zoom/rotation they're placed
  // under) changes.
  useEffect(() => {
    if (boxesOnPage.length === 0) {
      setScreenBoxes([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      boxesOnPage.map(async ({ box, index }) => {
        const rect = await doc.pdfRectToScreenRect(pageNumber, scale, rotation, box.rect);
        return { index, rect };
      }),
    ).then((entries) => {
      if (!cancelled) setScreenBoxes(entries);
    });
    return () => {
      cancelled = true;
    };
    // boxesKey captures exactly the boxes-on-this-page identity/geometry; boxesOnPage itself is a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, rotation, boxesKey]);

  const localPoint = useCallback((e: ReactPointerEvent<HTMLDivElement>): ScreenPoint => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  if (!redactOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 cursor-crosshair"
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = localPoint(e);
        setDragStart(p);
        setDragCurrent(p);
      }}
      onPointerMove={(e) => {
        if (!dragStart) return;
        setDragCurrent(localPoint(e));
      }}
      onPointerUp={async () => {
        if (!dragStart || !dragCurrent) return;
        const screenRect = {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        };
        setDragStart(null);
        setDragCurrent(null);
        if (screenRect.width < 6 || screenRect.height < 6) return; // ignore accidental clicks
        const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, screenRect.x, screenRect.y);
        const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, screenRect.x + screenRect.width, screenRect.y + screenRect.height);
        addRedactBox(pageIndex, {
          x: Math.min(p1.x, p2.x),
          y: Math.min(p1.y, p2.y),
          width: Math.abs(p2.x - p1.x),
          height: Math.abs(p2.y - p1.y),
        });
      }}
    >
      {dragStart && dragCurrent && (
        <div
          className="pointer-events-none absolute border-2 border-black bg-black/70"
          style={{
            left: Math.min(dragStart.x, dragCurrent.x),
            top: Math.min(dragStart.y, dragCurrent.y),
            width: Math.abs(dragCurrent.x - dragStart.x),
            height: Math.abs(dragCurrent.y - dragStart.y),
          }}
        />
      )}
      {screenBoxes.map(({ index, rect }) => (
        <div
          key={index}
          className="group absolute flex items-center justify-center border-2 border-black bg-black/70"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              removeRedactBox(index);
            }}
            className="pointer-events-auto hidden h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black shadow group-hover:flex"
            aria-label="Remove this redaction box"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
