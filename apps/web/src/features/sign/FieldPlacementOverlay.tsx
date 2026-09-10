import type { PdfDocument } from "@pdfloom/core";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type PlacementFieldType = "signature" | "initials" | "date";

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedField {
  id: string;
  signerIndex: number;
  fieldType: PlacementFieldType;
  pageNumber: number;
  rect: PdfRect;
}

interface ScreenRect extends PdfRect {}

const DEFAULT_SIZE_PT: Record<PlacementFieldType, { width: number; height: number }> = {
  signature: { width: 160, height: 50 },
  initials: { width: 60, height: 40 },
  date: { width: 110, height: 24 },
};

const FIELD_LABEL: Record<PlacementFieldType, string> = { signature: "Signature", initials: "Initials", date: "Date" };

export const SIGNER_COLORS = ["#6C5CE7", "#00B894", "#E17055", "#0984E3", "#D63031", "#FDCB6E", "#00CEC9", "#A29BFE"];

type DragState = { id: string; mode: "move" | "resize"; startPointer: { x: number; y: number }; startRect: ScreenRect };

export interface FieldPlacementOverlayProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  /** Every field across every page of the request — this overlay filters to its own page. */
  fields: PlacedField[];
  activeSignerIndex: number;
  /** When set, a click on empty page space places a new field of this type for activeSignerIndex. Null = browse/edit existing fields only. */
  activeFieldType: PlacementFieldType | null;
  onPlace: (rect: PdfRect) => void;
  onMove: (fieldId: string, rect: PdfRect) => void;
  onRemove: (fieldId: string) => void;
}

/**
 * Click-to-place, then drag to move or use the corner handle to resize — a
 * deliberately narrower interaction than SignaturePlaceOverlay's full
 * 8-handle/snap-guide/keyboard-nudge treatment (that component bakes ONE
 * in-progress placement straight into the open PDF on commit; this one
 * manages a whole LIST of placements as pure metadata sent to the API at
 * send time, across every signer and every page, which is a different
 * enough data shape that forking its full interaction surface wasn't
 * worth the added complexity here). Real drag/resize either way, not a
 * stub — just single-handle resize instead of eight.
 */
export function FieldPlacementOverlay({ doc, pageNumber, scale, fields, activeSignerIndex, activeFieldType, onPlace, onMove, onRemove }: FieldPlacementOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [screenRects, setScreenRects] = useState<Record<string, ScreenRect>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const pageFields = fields.filter((f) => f.pageNumber === pageNumber);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      pageFields.map(async (f) => [f.id, await doc.pdfRectToScreenRect(pageNumber, scale, 0, f.rect)] as const),
    ).then((entries) => {
      if (!cancelled) setScreenRects((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, JSON.stringify(pageFields.map((f) => [f.id, f.rect]))]);

  const localPoint = (e: ReactPointerEvent): { x: number; y: number } => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleRootPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    setSelectedId(null);
    if (!activeFieldType) return;
    e.preventDefault();
    const size = DEFAULT_SIZE_PT[activeFieldType];
    const screenWidth = size.width * scale;
    const screenHeight = size.height * scale;
    const p = localPoint(e);
    const screenX = p.x - screenWidth / 2;
    const screenY = p.y - screenHeight / 2;
    void (async () => {
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, 0, screenX, screenY);
      const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, 0, screenX + screenWidth, screenY + screenHeight);
      onPlace({
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      });
    })();
  };

  const beginMove = (field: PlacedField) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = screenRects[field.id];
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(field.id);
    setDragState({ id: field.id, mode: "move", startPointer: localPoint(e), startRect: rect });
  };

  const beginResize = (field: PlacedField) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = screenRects[field.id];
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ id: field.id, mode: "resize", startPointer: localPoint(e), startRect: rect });
  };

  const handleDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    e.preventDefault();
    const p = localPoint(e);
    const dx = p.x - dragState.startPointer.x;
    const dy = p.y - dragState.startPointer.y;
    if (dragState.mode === "move") {
      setScreenRects((prev) => ({ ...prev, [dragState.id]: { ...dragState.startRect, x: dragState.startRect.x + dx, y: dragState.startRect.y + dy } }));
    } else {
      const minSize = 14 * scale;
      setScreenRects((prev) => ({
        ...prev,
        [dragState.id]: {
          ...dragState.startRect,
          width: Math.max(minSize, dragState.startRect.width + dx),
          height: Math.max(minSize, dragState.startRect.height + dy),
        },
      }));
    }
  };

  const handleDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const finalRect = screenRects[dragState.id];
    const fieldId = dragState.id;
    setDragState(null);
    if (!finalRect) return;
    void (async () => {
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, 0, finalRect.x, finalRect.y);
      const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, 0, finalRect.x + finalRect.width, finalRect.y + finalRect.height);
      onMove(fieldId, {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      });
    })();
  };

  return (
    <div
      ref={overlayRef}
      className={`absolute inset-0 z-10 touch-none ${activeFieldType ? "cursor-crosshair" : "cursor-default"}`}
      onPointerDown={handleRootPointerDown}
    >
      {pageFields.map((field) => {
        const rect = screenRects[field.id];
        if (!rect) return null;
        const color = SIGNER_COLORS[field.signerIndex % SIGNER_COLORS.length]!;
        const isActive = field.signerIndex === activeSignerIndex;
        const isSelected = selectedId === field.id;
        return (
          <div
            key={field.id}
            onPointerDown={beginMove(field)}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            className="absolute flex touch-none cursor-move items-center justify-center rounded-[2px] text-[10px] font-medium"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              border: `2px ${isActive ? "solid" : "dashed"} ${color}`,
              backgroundColor: `${color}22`,
              color,
              opacity: isActive ? 1 : 0.55,
            }}
          >
            <span className="pointer-events-none truncate px-1">{FIELD_LABEL[field.fieldType]}</span>
            {isSelected && (
              <>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onRemove(field.id)}
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-bg text-text-muted shadow-[--shadow-floating] hover:text-danger"
                  aria-label="Remove this field"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <div
                  onPointerDown={beginResize(field)}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                  className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-full border bg-white"
                  style={{ borderColor: color }}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
