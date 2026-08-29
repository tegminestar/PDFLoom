import { getPdfWorkerClient, type PdfDocument } from "@pdfloom/core";
import { toast } from "@pdfloom/ui";
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

const DRAW_TOOLS: AnnotateTool[] = ["ink", "square", "circle", "line"];
const DEFAULT_TEXT_BOX = { width: 220, height: 70 };
const DEFAULT_STAMP_BOX = { width: 160, height: 56 };

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
  const [textBox, setTextBox] = useState<{ x: number; y: number; value: string } | null>(null);

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
    async (box: { x: number; y: number; value: string }) => {
      const text = box.value.trim();
      setTextBox(null);
      if (!text) return;
      try {
        const p1 = await toPdf({ x: box.x, y: box.y });
        const p2 = await toPdf({ x: box.x + DEFAULT_TEXT_BOX.width, y: box.y + DEFAULT_TEXT_BOX.height });
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
        if (textBox) return; // finish existing text box first
        const p = localPoint(e);
        if (tool === "stamp") {
          void commitStamp(p);
          return;
        }
        if (tool === "text") {
          setTextBox({ x: p.x, y: p.y, value: "" });
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
        <textarea
          autoFocus
          value={textBox.value}
          placeholder="Type a comment…"
          onChange={(e) => setTextBox((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={() => {
            if (textBox) void commitText(textBox);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setTextBox(null);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void commitText(textBox);
          }}
          className="absolute resize-none rounded-[--radius-sm] border-2 p-2 text-sm shadow-[--shadow-floating] outline-none"
          style={{
            left: textBox.x,
            top: textBox.y,
            width: DEFAULT_TEXT_BOX.width,
            height: DEFAULT_TEXT_BOX.height,
            borderColor: colorHex(color),
            background: "rgb(255 250 224)",
            color: "#1a1204",
          }}
        />
      )}
    </div>
  );
}
