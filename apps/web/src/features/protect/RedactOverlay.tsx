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

type HandleId = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
const RESIZE_HANDLES: HandleId[] = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];
const HANDLE_SPEC: Record<HandleId, { left: boolean; right: boolean; top: boolean; bottom: boolean }> = {
  nw: { left: true, right: false, top: true, bottom: false },
  n: { left: false, right: false, top: true, bottom: false },
  ne: { left: false, right: true, top: true, bottom: false },
  w: { left: true, right: false, top: false, bottom: false },
  e: { left: false, right: true, top: false, bottom: false },
  sw: { left: true, right: false, top: false, bottom: true },
  s: { left: false, right: false, top: false, bottom: true },
  se: { left: false, right: true, top: false, bottom: true },
};
const HANDLE_POSITION: Record<HandleId, { left: string; top: string }> = {
  nw: { left: "0%", top: "0%" },
  n: { left: "50%", top: "0%" },
  ne: { left: "100%", top: "0%" },
  w: { left: "0%", top: "50%" },
  e: { left: "100%", top: "50%" },
  sw: { left: "0%", top: "100%" },
  s: { left: "50%", top: "100%" },
  se: { left: "100%", top: "100%" },
};
const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: "cursor-nwse-resize",
  se: "cursor-nwse-resize",
  ne: "cursor-nesw-resize",
  sw: "cursor-nesw-resize",
  n: "cursor-ns-resize",
  s: "cursor-ns-resize",
  e: "cursor-ew-resize",
  w: "cursor-ew-resize",
};
const MIN_BOX_PX = 16;
const EDGE_MARGIN = 10;

type DragMode =
  | { kind: "move"; startPointer: ScreenPoint; startRect: ScreenRect }
  | { kind: "resize"; handle: HandleId; startPointer: ScreenPoint; startRect: ScreenRect };

/**
 * Draws pending redaction boxes across any page — they aren't applied
 * until RedactToolbar's "Apply redactions" runs (which rasterizes every
 * affected page and burns the boxes in for real, see redact.ts), so this
 * overlay is purely about marking *where*, not doing the actual redaction.
 * A box can be selected (click it, or it's auto-selected right after being
 * drawn) to drag-move or resize it in place — imprecise redaction boxes are
 * a real privacy risk, not just a cosmetic annoyance, so "delete and redraw
 * from scratch" was never a good enough correction story for this tool.
 */
export function RedactOverlay({ doc, pageNumber, scale, rotation }: RedactOverlayProps) {
  const redactOpen = useLoomStore((s) => s.redactOpen);
  const redactBoxes = useLoomStore((s) => s.redactBoxes);
  const addRedactBox = useLoomStore((s) => s.addRedactBox);
  const updateRedactBox = useLoomStore((s) => s.updateRedactBox);
  const removeRedactBox = useLoomStore((s) => s.removeRedactBox);
  const selectedRedactBoxIndex = useLoomStore((s) => s.selectedRedactBoxIndex);
  const setSelectedRedactBoxIndex = useLoomStore((s) => s.setSelectedRedactBoxIndex);

  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<ScreenPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<ScreenPoint | null>(null);
  const [screenBoxes, setScreenBoxes] = useState<{ index: number; rect: ScreenRect }[]>([]);
  const [selectedScreenRect, setSelectedScreenRect] = useState<ScreenRect | null>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);

  const pageIndex = pageNumber - 1;
  const boxesOnPage = redactBoxes.map((box, index) => ({ box, index })).filter(({ box }) => box.pageIndex === pageIndex);
  const boxesKey = boxesOnPage.map(({ index, box }) => `${index}:${box.rect.x},${box.rect.y},${box.rect.width},${box.rect.height}`).join("|");
  const selectedOnThisPage =
    selectedRedactBoxIndex !== null && redactBoxes[selectedRedactBoxIndex]?.pageIndex === pageIndex ? selectedRedactBoxIndex : null;
  const selectedBox = selectedOnThisPage !== null ? redactBoxes[selectedOnThisPage]! : null;

  // Keep every non-selected box on this page positioned in screen space.
  useEffect(() => {
    const others = boxesOnPage.filter(({ index }) => index !== selectedOnThisPage);
    if (others.length === 0) {
      setScreenBoxes([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      others.map(async ({ box, index }) => {
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
  }, [doc, pageNumber, scale, rotation, boxesKey, selectedOnThisPage]);

  // Project the selected box's canonical PDF-space rect into screen space —
  // skipped mid-gesture so it doesn't fight the pointer-driven live value.
  useEffect(() => {
    if (!selectedBox || dragMode) {
      if (!selectedBox) setSelectedScreenRect(null);
      return;
    }
    let cancelled = false;
    doc.pdfRectToScreenRect(pageNumber, scale, rotation, selectedBox.rect).then((rect) => {
      if (!cancelled) setSelectedScreenRect(rect);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, rotation, selectedBox?.rect.x, selectedBox?.rect.y, selectedBox?.rect.width, selectedBox?.rect.height, dragMode]);

  const localPoint = useCallback((e: ReactPointerEvent<HTMLDivElement>): ScreenPoint => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const finalizeGesture = useCallback(
    async (finalRect: ScreenRect) => {
      if (selectedOnThisPage === null) return;
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, finalRect.x, finalRect.y);
      const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, finalRect.x + finalRect.width, finalRect.y + finalRect.height);
      updateRedactBox(selectedOnThisPage, {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      });
    },
    [doc, pageNumber, scale, rotation, selectedOnThisPage, updateRedactBox],
  );

  const beginMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectedScreenRect || selectedOnThisPage === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode({ kind: "move", startPointer: localPoint(e), startRect: selectedScreenRect });
  };

  const beginResize = (handle: HandleId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectedScreenRect) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode({ kind: "resize", handle, startPointer: localPoint(e), startRect: selectedScreenRect });
  };

  const handleDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragMode) return;
    e.preventDefault();
    const p = localPoint(e);
    const dx = p.x - dragMode.startPointer.x;
    const dy = p.y - dragMode.startPointer.y;
    const bounds = overlayRef.current!.getBoundingClientRect();

    // Clamp to the intersection of the page's own bounds and the
    // currently-visible viewport — see SignaturePlaceOverlay/
    // AnnotationDrawOverlay for the full rationale (a page is routinely
    // taller than the browser window, and a handle dragged below the fold
    // becomes physically unreachable).
    const visibleMinX = Math.max(0, -bounds.left) + EDGE_MARGIN;
    const visibleMaxX = Math.min(bounds.width, window.innerWidth - bounds.left) - EDGE_MARGIN;
    const visibleMinY = Math.max(0, -bounds.top) + EDGE_MARGIN;
    const visibleMaxY = Math.min(bounds.height, window.innerHeight - bounds.top) - EDGE_MARGIN;

    if (dragMode.kind === "move") {
      let x = dragMode.startRect.x + dx;
      let y = dragMode.startRect.y + dy;
      x = Math.min(Math.max(visibleMinX, x), Math.max(visibleMinX, visibleMaxX - dragMode.startRect.width));
      y = Math.min(Math.max(visibleMinY, y), Math.max(visibleMinY, visibleMaxY - dragMode.startRect.height));
      setSelectedScreenRect({ x, y, width: dragMode.startRect.width, height: dragMode.startRect.height });
      return;
    }

    const spec = HANDLE_SPEC[dragMode.handle];
    let x = dragMode.startRect.x;
    let y = dragMode.startRect.y;
    let width = dragMode.startRect.width;
    let height = dragMode.startRect.height;
    if (spec.left) {
      x = dragMode.startRect.x + dx;
      width = dragMode.startRect.width - dx;
    }
    if (spec.right) width = dragMode.startRect.width + dx;
    if (spec.top) {
      y = dragMode.startRect.y + dy;
      height = dragMode.startRect.height - dy;
    }
    if (spec.bottom) height = dragMode.startRect.height + dy;

    if (width < MIN_BOX_PX) {
      if (spec.left) x -= MIN_BOX_PX - width;
      width = MIN_BOX_PX;
    }
    if (height < MIN_BOX_PX) {
      if (spec.top) y -= MIN_BOX_PX - height;
      height = MIN_BOX_PX;
    }
    if (x < visibleMinX) {
      width -= visibleMinX - x;
      x = visibleMinX;
    }
    if (y < visibleMinY) {
      height -= visibleMinY - y;
      y = visibleMinY;
    }
    if (x + width > visibleMaxX) width = visibleMaxX - x;
    if (y + height > visibleMaxY) height = visibleMaxY - y;

    setSelectedScreenRect({ x, y, width, height });
  };

  const handleDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragMode || !selectedScreenRect) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragMode(null);
    void finalizeGesture(selectedScreenRect);
  };

  if (!redactOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 cursor-crosshair"
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        setSelectedRedactBoxIndex(null); // clicking empty space deselects, then starts drawing a new box
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
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSelectedRedactBoxIndex(index);
          }}
          className="group absolute cursor-move border-2 border-black bg-black/70"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          {/* Floats at a corner rather than the box's center — centering it
              (as this used to) sits exactly where a click naturally lands
              to select/move the box, so hovering to reveal it and clicking
              there silently deleted the box instead of selecting it. */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              removeRedactBox(index);
            }}
            className="absolute -right-2.5 -top-2.5 hidden h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black shadow group-hover:flex"
            aria-label="Remove this redaction box"
          >
            ×
          </button>
        </div>
      ))}

      {selectedOnThisPage !== null && selectedScreenRect && (
        <div
          onPointerDown={beginMove}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              removeRedactBox(selectedOnThisPage);
            } else if (e.key === "Escape") {
              setSelectedRedactBoxIndex(null);
            }
          }}
          className="absolute cursor-move border-2 border-ai bg-black/70 outline-none"
          style={{ left: selectedScreenRect.x, top: selectedScreenRect.y, width: selectedScreenRect.width, height: selectedScreenRect.height }}
        >
          {/* Floats at a corner, outside the box's own flow — centering it
              inside the box (as the non-selected boxes' hover button does)
              would sit exactly where a user naturally clicks to drag the
              box, silently swallowing every move attempt via this button's
              own stopPropagation. */}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              removeRedactBox(selectedOnThisPage);
            }}
            className="absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black shadow"
            aria-label="Remove this redaction box"
          >
            ×
          </button>

          {RESIZE_HANDLES.map((h) => (
            <div
              key={h}
              onPointerDown={beginResize(h)}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ai bg-white shadow ${HANDLE_CURSOR[h]}`}
              style={{ left: HANDLE_POSITION[h].left, top: HANDLE_POSITION[h].top }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
