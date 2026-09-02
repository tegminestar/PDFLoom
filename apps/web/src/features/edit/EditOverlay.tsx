import { getPdfWorkerClient, type PdfDocument } from "@pdfloom/core";
import { Button, toast } from "@pdfloom/ui";
import { Check, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useLoomStore } from "../../app/store";

export interface EditOverlayProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  /** The page's own DOM element (canvas + text layer's parent) — text-edit listens on it directly instead of an absorbing overlay div, so clicks still reach the real text-layer spans underneath. */
  pageContainerRef: RefObject<HTMLDivElement | null>;
}

interface ScreenPoint {
  x: number;
  y: number;
}
interface ScreenRect extends ScreenPoint {
  width: number;
  height: number;
}

interface PendingTextEdit {
  rect: ScreenRect;
  originalText: string;
}

interface PendingImageEdit {
  rect: ScreenRect;
  previewUrl: string;
  imageBytes: Uint8Array;
  imageType: "png" | "jpg";
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
 * Best-effort "edit" tools: pdf.js/pdf-lib can't locate-and-rewrite an
 * existing text run or image XObject inside a page's content stream from
 * the client, so both tools work by covering the original with a new
 * opaque appearance at the same spot — not true content-stream editing.
 * The toolbar copy and in-popover microcopy are explicit about this.
 *
 * Both the text-replacement box and the image-replacement box stay
 * adjustable before committing (drag to move, 8 handles to resize) — the
 * text box in particular needs this since a replacement that's longer or
 * shorter than the original otherwise has no way to avoid the font
 * shrinking to fit (or looking sparse in a box sized for longer text).
 */
export function EditOverlay({ doc, pageNumber, scale, rotation, pageContainerRef }: EditOverlayProps) {
  const editOpen = useLoomStore((s) => s.editOpen);
  const tool = useLoomStore((s) => s.editTool);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [textEdit, setTextEdit] = useState<PendingTextEdit | null>(null);
  const [textValue, setTextValue] = useState("");
  const [isSavingText, setIsSavingText] = useState(false);
  const [textDragMode, setTextDragMode] = useState<DragMode | null>(null);

  const [imageEdit, setImageEdit] = useState<PendingImageEdit | null>(null);
  const [dragStart, setDragStart] = useState<ScreenPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<ScreenPoint | null>(null);
  const [isReplacingImage, setIsReplacingImage] = useState(false);
  const [imageDragMode, setImageDragMode] = useState<DragMode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Text edit: listens directly on the page container so real clicks on
  // pdf.js's text-layer spans still land, instead of a blocking overlay div.
  useEffect(() => {
    if (!editOpen || tool !== "text") return;
    const container = pageContainerRef.current;
    if (!container) return;

    const handler = (e: MouseEvent) => {
      const span = (e.target as HTMLElement).closest<HTMLElement>(".loom-text-layer span");
      if (!span || !span.textContent?.trim()) return;
      e.preventDefault();
      e.stopPropagation();
      const containerRect = container.getBoundingClientRect();
      const spanRect = span.getBoundingClientRect();
      const padding = 2;
      const rect: ScreenRect = {
        x: spanRect.left - containerRect.left - padding,
        y: spanRect.top - containerRect.top - padding,
        width: spanRect.width + padding * 2,
        height: spanRect.height + padding * 2,
      };
      setTextValue(span.textContent);
      setTextEdit({ rect, originalText: span.textContent });
    };

    container.addEventListener("click", handler, true);
    return () => container.removeEventListener("click", handler, true);
  }, [editOpen, tool, pageContainerRef]);

  const commitTextEdit = useCallback(async () => {
    if (!textEdit) return;
    const newText = textValue.trim();
    setTextEdit(null);
    if (!newText || newText === textEdit.originalText) return;
    setIsSavingText(true);
    try {
      const r = textEdit.rect;
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, r.x, r.y);
      const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, r.x + r.width, r.y + r.height);
      const rect = {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      };
      const fontSize = Math.max(6, rect.height * 0.72);
      const client = await getPdfWorkerClient();
      const bytes = await client.addFreeText(await doc.getRawBytes(), pageNumber - 1, rect, newText, {
        fontSize,
        color: { r: 0.06, g: 0.06, b: 0.08 },
        box: { fill: { r: 1, g: 1, b: 1 } },
      });
      await applyPdfMutation(bytes);
      toast.success("Text replaced", "Covered the original with a new text box at the same spot.");
    } catch (error) {
      toast.error("Couldn't replace text", error instanceof Error ? error.message : undefined);
    } finally {
      setIsSavingText(false);
    }
  }, [applyPdfMutation, doc, pageNumber, rotation, scale, textEdit, textValue]);

  // --- Image edit: drag a rect (same gesture as the annotate "square" tool), pick a replacement file, then adjust before it's actually applied.
  // Uses pageContainerRef (always mounted, for both tools) rather than a
  // ref on the image tool's own absorbing div — that div doesn't exist at
  // all while the text tool is active, which left text-edit's move/resize
  // computing bounds from a stray fallback instead of the real page size.
  const localPoint = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): ScreenPoint => {
      const rect = pageContainerRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [pageContainerRef],
  );

  // Holds the just-drawn box's rect between "file picker opened" and "file
  // chosen" — dragStart/dragCurrent are already cleared by the time the
  // picker resolves (the drag gesture itself finished when it opened), so
  // handleFileChosen needs its own place to find that geometry. A ref
  // (read directly at call time below, not through a render-time local)
  // rather than state since nothing needs to re-render while the native
  // file picker is open.
  const pendingImageBoxRectRef = useRef<ScreenRect | null>(null);

  const handleFileChosen = useCallback(
    async (file: File) => {
      const rect = pendingImageBoxRectRef.current;
      if (!rect) return;
      const imageType = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : null;
      if (!imageType) {
        toast.error("Unsupported image type", "Choose a PNG or JPEG file.");
        return;
      }
      const imageBytes = new Uint8Array(await file.arrayBuffer());
      const previewUrl = URL.createObjectURL(new Blob([imageBytes as BlobPart]));
      setImageEdit({ rect, previewUrl, imageBytes, imageType });
    },
    [],
  );

  const commitImageEdit = useCallback(async () => {
    if (!imageEdit) return;
    const { rect: r, imageBytes, imageType } = imageEdit;
    URL.revokeObjectURL(imageEdit.previewUrl);
    setImageEdit(null);
    setIsReplacingImage(true);
    try {
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, r.x, r.y);
      const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, r.x + r.width, r.y + r.height);
      const rect = {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      };
      const client = await getPdfWorkerClient();
      const bytes = await client.replaceImageArea(await doc.getRawBytes(), pageNumber - 1, rect, imageBytes, imageType);
      await applyPdfMutation(bytes);
      toast.success("Image replaced", "Covered the selected area with the new image.");
    } catch (error) {
      toast.error("Couldn't replace image", error instanceof Error ? error.message : undefined);
    } finally {
      setIsReplacingImage(false);
    }
  }, [applyPdfMutation, doc, imageEdit, pageNumber, rotation, scale]);

  // --- Shared move/resize for whichever of textEdit/imageEdit is active (only one tool is ever selected at a time, so at most one has a pending box).
  const beginMove = (which: "text" | "image") => (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = which === "text" ? textEdit?.rect : imageEdit?.rect;
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const mode: DragMode = { kind: "move", startPointer: localPoint(e), startRect: rect };
    if (which === "text") setTextDragMode(mode);
    else setImageDragMode(mode);
  };

  const beginResize = (which: "text" | "image", handle: HandleId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = which === "text" ? textEdit?.rect : imageEdit?.rect;
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const mode: DragMode = { kind: "resize", handle, startPointer: localPoint(e), startRect: rect };
    if (which === "text") setTextDragMode(mode);
    else setImageDragMode(mode);
  };

  const computeDraggedRect = (dragMode: DragMode, p: ScreenPoint, bounds: DOMRect): ScreenRect => {
    const dx = p.x - dragMode.startPointer.x;
    const dy = p.y - dragMode.startPointer.y;
    const visibleMinX = Math.max(0, -bounds.left) + EDGE_MARGIN;
    const visibleMaxX = Math.min(bounds.width, window.innerWidth - bounds.left) - EDGE_MARGIN;
    const visibleMinY = Math.max(0, -bounds.top) + EDGE_MARGIN;
    const visibleMaxY = Math.min(bounds.height, window.innerHeight - bounds.top) - EDGE_MARGIN;

    if (dragMode.kind === "move") {
      let x = dragMode.startRect.x + dx;
      let y = dragMode.startRect.y + dy;
      x = Math.min(Math.max(visibleMinX, x), Math.max(visibleMinX, visibleMaxX - dragMode.startRect.width));
      y = Math.min(Math.max(visibleMinY, y), Math.max(visibleMinY, visibleMaxY - dragMode.startRect.height));
      return { x, y, width: dragMode.startRect.width, height: dragMode.startRect.height };
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

    return { x, y, width, height };
  };

  const handleTextDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!textDragMode) return;
    e.preventDefault();
    const bounds = pageContainerRef.current!.getBoundingClientRect();
    const rect = computeDraggedRect(textDragMode, localPoint(e), bounds);
    setTextEdit((prev) => (prev ? { ...prev, rect } : prev));
  };
  const handleTextDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!textDragMode) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setTextDragMode(null);
  };
  const handleImageDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageDragMode) return;
    e.preventDefault();
    const bounds = pageContainerRef.current!.getBoundingClientRect();
    const rect = computeDraggedRect(imageDragMode, localPoint(e), bounds);
    setImageEdit((prev) => (prev ? { ...prev, rect } : prev));
  };
  const handleImageDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageDragMode) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setImageDragMode(null);
  };

  if (!editOpen) return null;

  return (
    <>
      {tool === "text" && textEdit && (
        <>
          <div
            onPointerDown={beginMove("text")}
            onPointerMove={handleTextDragMove}
            onPointerUp={handleTextDragEnd}
            onPointerCancel={handleTextDragEnd}
            className="absolute z-10 cursor-move overflow-hidden border-2 border-dashed border-primary bg-white outline-none"
            style={{ left: textEdit.rect.x, top: textEdit.rect.y, width: textEdit.rect.width, height: textEdit.rect.height }}
          >
            {/* Live preview of the replacement — mirrors addFreeTextInternal's
                sizing (fontSize = 72% of box height, 4pt/[scale] padding) so
                what's shown while dragging matches what gets baked in on commit. */}
            <div
              aria-hidden
              className="pointer-events-none h-full w-full overflow-hidden whitespace-pre-wrap break-words text-[#0f0f14]"
              style={{
                padding: 4 * scale,
                fontFamily: "Helvetica, Arial, sans-serif",
                fontSize: Math.max(6, textEdit.rect.height * 0.72),
                lineHeight: 1.25,
              }}
            >
              {textValue}
            </div>

            {RESIZE_HANDLES.map((h) => (
              <div
                key={h}
                onPointerDown={beginResize("text", h)}
                onPointerMove={handleTextDragMove}
                onPointerUp={handleTextDragEnd}
                onPointerCancel={handleTextDragEnd}
                className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow ${HANDLE_CURSOR[h]}`}
                style={{ left: HANDLE_POSITION[h].left, top: HANDLE_POSITION[h].top }}
              />
            ))}
          </div>

          <div
            role="dialog"
            aria-label="Replace text"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 flex w-72 flex-col gap-2 rounded-[--radius-md] border border-border-strong bg-surface p-3 text-sm shadow-[--shadow-floating]"
            style={{ left: textEdit.rect.x, top: textEdit.rect.y + textEdit.rect.height + 6 }}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">Replace text</span>
            <textarea
              autoFocus
              rows={3}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              className="resize-none rounded-[--radius-sm] border border-border-strong bg-bg p-2 text-text outline-none focus-visible:border-primary"
            />
            <p className="text-[11px] leading-snug text-text-faint">
              Covers the original text with a new text box — drag the dashed box's edges to resize it if the
              replacement is a different length, or its middle to move it.
            </p>
            <div className="mt-1 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setTextEdit(null)} disabled={isSavingText}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => void commitTextEdit()} disabled={isSavingText || !textValue.trim()}>
                {isSavingText ? "Replacing…" : "Replace"}
              </Button>
            </div>
          </div>
        </>
      )}

      {tool === "image" && (
        <div
          className="absolute inset-0 z-10 cursor-crosshair"
          onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            if (imageEdit) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = localPoint(e);
            setDragStart(p);
            setDragCurrent(p);
          }}
          onPointerMove={(e) => {
            if (!dragStart) return;
            setDragCurrent(localPoint(e));
          }}
          onPointerUp={() => {
            if (!dragStart || !dragCurrent) return;
            const screenRect: ScreenRect = {
              x: Math.min(dragStart.x, dragCurrent.x),
              y: Math.min(dragStart.y, dragCurrent.y),
              width: Math.abs(dragCurrent.x - dragStart.x),
              height: Math.abs(dragCurrent.y - dragStart.y),
            };
            setDragStart(null);
            setDragCurrent(null);
            if (screenRect.width < 8 || screenRect.height < 8) return; // ignore accidental clicks
            pendingImageBoxRectRef.current = screenRect;
            fileInputRef.current?.click();
          }}
        >
          {dragStart && dragCurrent && (
            <div
              className="pointer-events-none absolute border-2 border-primary bg-primary/10"
              style={{
                left: Math.min(dragStart.x, dragCurrent.x),
                top: Math.min(dragStart.y, dragCurrent.y),
                width: Math.abs(dragCurrent.x - dragStart.x),
                height: Math.abs(dragCurrent.y - dragStart.y),
              }}
            />
          )}

          {imageEdit && (
            <div
              onPointerDown={beginMove("image")}
              onPointerMove={handleImageDragMove}
              onPointerUp={handleImageDragEnd}
              onPointerCancel={handleImageDragEnd}
              className="absolute cursor-move border-2 border-dashed border-primary bg-white/90"
              style={{ left: imageEdit.rect.x, top: imageEdit.rect.y, width: imageEdit.rect.width, height: imageEdit.rect.height }}
            >
              <img src={imageEdit.previewUrl} alt="" className="pointer-events-none h-full w-full object-contain" />

              <div
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-strong bg-surface px-1.5 py-1 shadow-[--shadow-floating]"
                style={{ top: imageEdit.rect.y > 40 ? -38 : imageEdit.rect.height + 6 }}
              >
                <button
                  type="button"
                  onClick={() => void commitImageEdit()}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-text hover:opacity-90"
                  aria-label="Replace with this image"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(imageEdit.previewUrl);
                    setImageEdit(null);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-bg text-text-muted hover:text-text"
                  aria-label="Discard replacement image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {RESIZE_HANDLES.map((h) => (
                <div
                  key={h}
                  onPointerDown={beginResize("image", h)}
                  onPointerMove={handleImageDragMove}
                  onPointerUp={handleImageDragEnd}
                  onPointerCancel={handleImageDragEnd}
                  className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow ${HANDLE_CURSOR[h]}`}
                  style={{ left: HANDLE_POSITION[h].left, top: HANDLE_POSITION[h].top }}
                />
              ))}
            </div>
          )}

          {isReplacingImage && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/40 text-xs text-text-faint">
              Replacing…
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFileChosen(file);
            }}
          />
        </div>
      )}
    </>
  );
}
