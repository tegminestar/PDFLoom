import { getPdfWorkerClient, type PdfDocument } from "@pdfloom/core";
import { toast } from "@pdfloom/ui";
import { Check, GripHorizontal, X } from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLoomStore, type AnnotateTool } from "../../app/store";

export interface AnnotationDrawOverlayProps {
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
interface PendingTextBox extends ScreenRect {
  value: string;
}

const DRAW_TOOLS: AnnotateTool[] = ["ink", "square", "circle", "line"];
const DEFAULT_TEXT_BOX = { width: 220, height: 70 };
const DEFAULT_STAMP_BOX = { width: 160, height: 56 };
const MIN_TEXT_BOX = { width: 60, height: 28 };
const SNAP_PX = 6;

// Free-resize only (a comment box has no aspect ratio to preserve, unlike
// SignaturePlaceOverlay's image-asset case) — 8 handles, corners + edges.
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

type DragMode =
  | { kind: "move"; startPointer: ScreenPoint; startRect: ScreenRect }
  | { kind: "resize"; handle: HandleId; startPointer: ScreenPoint; startRect: ScreenRect };

function colorHex(c: { r: number; g: number; b: number }): string {
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`;
}

/**
 * Captures pointer gestures for the drawing-based annotation tools (ink,
 * shapes, text box, stamp) and turns them into real PDF annotations via the
 * worker. Markup tools (highlight/underline/strikeout) don't use this layer
 * at all — they ride on the text layer's native selection instead, handled
 * by SelectionMarkupToolbar, so this overlay must never block pointer
 * events for those or for read-mode scrolling when no drawing tool is active.
 */
export function AnnotationDrawOverlay({ doc, pageNumber, scale, rotation }: AnnotationDrawOverlayProps) {
  const annotateOpen = useLoomStore((s) => s.annotateOpen);
  const tool = useLoomStore((s) => s.annotateTool);
  const color = useLoomStore((s) => s.annotateColor);
  const stampPreset = useLoomStore((s) => s.annotateStampPreset);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<ScreenPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<ScreenPoint | null>(null);
  const [inkPoints, setInkPoints] = useState<ScreenPoint[]>([]);
  const [textBox, setTextBox] = useState<PendingTextBox | null>(null);
  const [textBoxDragMode, setTextBoxDragMode] = useState<DragMode | null>(null);
  const [textBoxSnapGuides, setTextBoxSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const localPoint = useCallback((e: ReactPointerEvent<HTMLDivElement>): ScreenPoint => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const toPdf = useCallback(
    (p: ScreenPoint) => doc.screenPointToPdfPoint(pageNumber, scale, rotation, p.x, p.y),
    [doc, pageNumber, scale, rotation],
  );

  const commitShape = useCallback(
    async (start: ScreenPoint, end: ScreenPoint) => {
      if (Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3) return; // ignore accidental clicks
      const client = await getPdfWorkerClient();
      const p1 = await toPdf(start);
      const p2 = await toPdf(end);
      const rect = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
      try {
        let bytes: Uint8Array;
        if (tool === "square") {
          bytes = await client.addSquare(await doc.getRawBytes(), pageNumber - 1, rect, { strokeColor: color, lineWidth: 2 });
        } else if (tool === "circle") {
          bytes = await client.addCircle(await doc.getRawBytes(), pageNumber - 1, rect, { strokeColor: color, lineWidth: 2 });
        } else {
          bytes = await client.addLine(await doc.getRawBytes(), pageNumber - 1, p1, p2, { strokeColor: color, lineWidth: 2.5, arrowEnd: true });
        }
        await applyPdfMutation(bytes);
        toast.success(tool === "line" ? "Added line" : `Added ${tool}`);
      } catch (error) {
        toast.error("Couldn't add annotation", error instanceof Error ? error.message : undefined);
      }
    },
    [applyPdfMutation, color, doc, pageNumber, toPdf, tool],
  );

  const commitInk = useCallback(
    async (points: ScreenPoint[]) => {
      if (points.length < 2) return;
      try {
        const pdfPoints = await Promise.all(points.map((p) => toPdf(p)));
        const client = await getPdfWorkerClient();
        const bytes = await client.addInk(await doc.getRawBytes(), pageNumber - 1, [pdfPoints], { color, lineWidth: 2.5 });
        await applyPdfMutation(bytes);
        toast.success("Added drawing");
      } catch (error) {
        toast.error("Couldn't add drawing", error instanceof Error ? error.message : undefined);
      }
    },
    [applyPdfMutation, color, doc, pageNumber, toPdf],
  );

  const commitStamp = useCallback(
    async (point: ScreenPoint) => {
      try {
        const p1 = await toPdf({ x: point.x - DEFAULT_STAMP_BOX.width / 2, y: point.y - DEFAULT_STAMP_BOX.height / 2 });
        const p2 = await toPdf({ x: point.x + DEFAULT_STAMP_BOX.width / 2, y: point.y + DEFAULT_STAMP_BOX.height / 2 });
        const rect = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
        const client = await getPdfWorkerClient();
        const bytes = await client.addStamp(await doc.getRawBytes(), pageNumber - 1, rect, stampPreset);
        await applyPdfMutation(bytes);
        toast.success("Added stamp");
      } catch (error) {
        toast.error("Couldn't add stamp", error instanceof Error ? error.message : undefined);
      }
    },
    [applyPdfMutation, doc, pageNumber, stampPreset, toPdf],
  );

  const commitText = useCallback(
    async (box: PendingTextBox) => {
      const text = box.value.trim();
      setTextBox(null);
      if (!text) return;
      try {
        const p1 = await toPdf({ x: box.x, y: box.y });
        const p2 = await toPdf({ x: box.x + box.width, y: box.y + box.height });
        const rect = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
        const client = await getPdfWorkerClient();
        const bytes = await client.addFreeText(await doc.getRawBytes(), pageNumber - 1, rect, text, {
          color: { r: 0.1, g: 0.1, b: 0.1 },
          box: { fill: { r: 1, g: 0.98, b: 0.75 }, stroke: color, lineWidth: 1 },
        });
        await applyPdfMutation(bytes);
        toast.success("Added comment");
      } catch (error) {
        toast.error("Couldn't add comment", error instanceof Error ? error.message : undefined);
      }
    },
    [applyPdfMutation, color, doc, pageNumber, toPdf],
  );

  // Move: drag via the header grip. Resize: drag any of the 8 handles.
  // Both work purely in local screen-space (no PDF-point conversion mid-
  // gesture, unlike SignaturePlaceOverlay) since the box only needs to
  // become a PDF rect once, at commitText time via the existing toPdf calls
  // above — there's no live "draft already in PDF-space" state to keep in
  // sync here.
  const beginTextBoxMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!textBox) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setTextBoxDragMode({ kind: "move", startPointer: localPoint(e), startRect: textBox });
    },
    [localPoint, textBox],
  );

  const beginTextBoxResize = useCallback(
    (handle: HandleId) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!textBox) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setTextBoxDragMode({ kind: "resize", handle, startPointer: localPoint(e), startRect: textBox });
    },
    [localPoint, textBox],
  );

  const handleTextBoxDragMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!textBoxDragMode) return;
      e.preventDefault();
      const p = localPoint(e);
      const dx = p.x - textBoxDragMode.startPointer.x;
      const dy = p.y - textBoxDragMode.startPointer.y;
      const bounds = overlayRef.current!.getBoundingClientRect();

      // Clamp to the intersection of the page's own bounds and the
      // currently-visible viewport, not just the page — a PDF page is
      // routinely taller than the browser window at any real zoom level,
      // and a box (or its own resize handles) dragged below the visible
      // fold becomes physically unreachable without scrolling first. The
      // EDGE_MARGIN keeps a resize handle's own hit-circle (it's centered
      // exactly on the box's edge) from landing right on the viewport's
      // boundary pixel, which is outside the hit-testable range.
      const EDGE_MARGIN = 10;
      const visibleMinX = Math.max(0, -bounds.left) + EDGE_MARGIN;
      const visibleMaxX = Math.min(bounds.width, window.innerWidth - bounds.left) - EDGE_MARGIN;
      const visibleMinY = Math.max(0, -bounds.top) + EDGE_MARGIN;
      const visibleMaxY = Math.min(bounds.height, window.innerHeight - bounds.top) - EDGE_MARGIN;

      if (textBoxDragMode.kind === "move") {
        let x = textBoxDragMode.startRect.x + dx;
        let y = textBoxDragMode.startRect.y + dy;
        x = Math.min(Math.max(visibleMinX, x), Math.max(visibleMinX, visibleMaxX - textBoxDragMode.startRect.width));
        y = Math.min(Math.max(visibleMinY, y), Math.max(visibleMinY, visibleMaxY - textBoxDragMode.startRect.height));

        const centerX = x + textBoxDragMode.startRect.width / 2;
        const centerY = y + textBoxDragMode.startRect.height / 2;
        const pageCenterX = bounds.width / 2;
        const pageCenterY = bounds.height / 2;
        let snapX: number | null = null;
        let snapY: number | null = null;
        if (Math.abs(centerX - pageCenterX) < SNAP_PX) {
          x = pageCenterX - textBoxDragMode.startRect.width / 2;
          snapX = pageCenterX;
        }
        if (Math.abs(centerY - pageCenterY) < SNAP_PX) {
          y = pageCenterY - textBoxDragMode.startRect.height / 2;
          snapY = pageCenterY;
        }
        setTextBoxSnapGuides({ x: snapX, y: snapY });
        setTextBox((prev) => (prev ? { ...prev, x, y } : prev));
        return;
      }

      const spec = HANDLE_SPEC[textBoxDragMode.handle];
      let x = textBoxDragMode.startRect.x;
      let y = textBoxDragMode.startRect.y;
      let width = textBoxDragMode.startRect.width;
      let height = textBoxDragMode.startRect.height;
      if (spec.left) {
        x = textBoxDragMode.startRect.x + dx;
        width = textBoxDragMode.startRect.width - dx;
      }
      if (spec.right) width = textBoxDragMode.startRect.width + dx;
      if (spec.top) {
        y = textBoxDragMode.startRect.y + dy;
        height = textBoxDragMode.startRect.height - dy;
      }
      if (spec.bottom) height = textBoxDragMode.startRect.height + dy;

      if (width < MIN_TEXT_BOX.width) {
        if (spec.left) x -= MIN_TEXT_BOX.width - width;
        width = MIN_TEXT_BOX.width;
      }
      if (height < MIN_TEXT_BOX.height) {
        if (spec.top) y -= MIN_TEXT_BOX.height - height;
        height = MIN_TEXT_BOX.height;
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

      setTextBox((prev) => (prev ? { ...prev, x, y, width, height } : prev));
    },
    [localPoint, textBoxDragMode],
  );

  const handleTextBoxDragEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!textBoxDragMode) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setTextBoxDragMode(null);
    setTextBoxSnapGuides({ x: null, y: null });
  }, [textBoxDragMode]);

  const isDrawTool = DRAW_TOOLS.includes(tool);
  const isPlacementTool = tool === "text" || tool === "stamp";
  if (!annotateOpen || (!isDrawTool && !isPlacementTool)) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10"
      style={{ cursor: tool === "text" || tool === "stamp" ? "crosshair" : "crosshair" }}
      onPointerDown={(e) => {
        // Without this, browsers can undo a .focus() applied to a newly
        // created element (our text-box textarea, focused via autoFocus)
        // as part of their default click-gesture focus handling — the
        // textarea would flash into existence and immediately blur itself
        // before a user could type anything.
        e.preventDefault();
        if (textBox) {
          // A pending comment box already exists — clicking anywhere else
          // on the page (regardless of which tool is now selected)
          // finalizes it at its current position/size/text, rather than
          // silently discarding whatever was typed.
          void commitText(textBox);
          return;
        }
        const p = localPoint(e);
        if (tool === "stamp") {
          void commitStamp(p);
          return;
        }
        if (tool === "text") {
          setTextBox({ x: p.x, y: p.y, width: DEFAULT_TEXT_BOX.width, height: DEFAULT_TEXT_BOX.height, value: "" });
          return;
        }
        if (!isDrawTool) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragStart(p);
        setDragCurrent(p);
        if (tool === "ink") setInkPoints([p]);
      }}
      onPointerMove={(e) => {
        if (!dragStart) return;
        const p = localPoint(e);
        setDragCurrent(p);
        if (tool === "ink") setInkPoints((prev) => [...prev, p]);
      }}
      onPointerUp={() => {
        if (!dragStart || !dragCurrent) return;
        if (tool === "ink") {
          void commitInk(inkPoints);
          setInkPoints([]);
        } else {
          void commitShape(dragStart, dragCurrent);
        }
        setDragStart(null);
        setDragCurrent(null);
      }}
    >
      {/* Live preview while dragging a shape */}
      {dragStart && dragCurrent && tool !== "ink" && (
        <div
          className="pointer-events-none absolute border-2"
          style={{
            left: Math.min(dragStart.x, dragCurrent.x),
            top: Math.min(dragStart.y, dragCurrent.y),
            width: Math.abs(dragCurrent.x - dragStart.x),
            height: Math.abs(dragCurrent.y - dragStart.y),
            borderColor: colorHex(color),
            borderRadius: tool === "circle" ? "999px" : 0,
          }}
        />
      )}
      {inkPoints.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
          <polyline
            points={inkPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={colorHex(color)}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {textBox && (
        <>
          {textBoxSnapGuides.x !== null && (
            <div className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: textBoxSnapGuides.x }} />
          )}
          {textBoxSnapGuides.y !== null && (
            <div className="pointer-events-none absolute inset-x-0 h-px bg-primary" style={{ top: textBoxSnapGuides.y }} />
          )}

          <div className="absolute" style={{ left: textBox.x, top: textBox.y, width: textBox.width, height: textBox.height }}>
            {/* Drag handle — the textarea itself has to stay a normal
                click-to-position-cursor editable surface, so moving the box
                is a separate grip strip rather than "drag the textarea". */}
            <div
              onPointerDown={beginTextBoxMove}
              onPointerMove={handleTextBoxDragMove}
              onPointerUp={handleTextBoxDragEnd}
              onPointerCancel={handleTextBoxDragEnd}
              className="absolute -top-7 left-0 flex h-6 cursor-move items-center gap-1 rounded-[--radius-sm] px-2 text-[11px] font-medium text-white"
              style={{ background: colorHex(color) }}
            >
              <GripHorizontal className="h-3 w-3" />
              Comment
            </div>
            <div
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="absolute -top-7 right-0 flex items-center gap-1"
            >
              <button
                type="button"
                onClick={() => void commitText(textBox)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-text hover:opacity-90"
                aria-label="Add comment"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setTextBox(null)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-bg text-text-muted hover:text-text"
                aria-label="Discard comment"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <textarea
              autoFocus
              value={textBox.value}
              placeholder="Type a comment…"
              onChange={(e) => setTextBox((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={() => {
                // Only auto-commits on a genuine focus-leave (e.g. the user
                // clicked a different toolbar button entirely) — every
                // interaction within this overlay (the grip, resize
                // handles, the buttons above) prevents the focus-shift that
                // would otherwise trigger this, so it can't double-fire
                // alongside the explicit commit paths.
                if (textBox) void commitText(textBox);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setTextBox(null);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commitText(textBox);
              }}
              className="h-full w-full resize-none rounded-[--radius-sm] border-2 p-2 text-sm shadow-[--shadow-floating] outline-none"
              style={{
                borderColor: colorHex(color),
                background: "rgb(255 250 224)",
                color: "#1a1204",
              }}
            />

            {RESIZE_HANDLES.map((h) => (
              <div
                key={h}
                onPointerDown={beginTextBoxResize(h)}
                onPointerMove={handleTextBoxDragMove}
                onPointerUp={handleTextBoxDragEnd}
                onPointerCancel={handleTextBoxDragEnd}
                className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white shadow ${HANDLE_CURSOR[h]}`}
                style={{ left: HANDLE_POSITION[h].left, top: HANDLE_POSITION[h].top, borderColor: colorHex(color) }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
