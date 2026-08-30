import { getPdfWorkerClient, type PdfDocument } from "@pdfloom/core";
import { Button, toast } from "@pdfloom/ui";
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
  screenRect: ScreenRect;
  originalText: string;
}

interface PendingImageEdit {
  screenRect: ScreenRect;
}

/**
 * Best-effort "edit" tools: pdf.js/pdf-lib can't locate-and-rewrite an
 * existing text run or image XObject inside a page's content stream from
 * the client, so both tools work by covering the original with a new
 * opaque appearance at the same spot — not true content-stream editing.
 * The toolbar copy and in-popover microcopy are explicit about this.
 */
export function EditOverlay({ doc, pageNumber, scale, rotation, pageContainerRef }: EditOverlayProps) {
  const editOpen = useLoomStore((s) => s.editOpen);
  const tool = useLoomStore((s) => s.editTool);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [textEdit, setTextEdit] = useState<PendingTextEdit | null>(null);
  const [textValue, setTextValue] = useState("");
  const [isSavingText, setIsSavingText] = useState(false);

  const [imageEdit, setImageEdit] = useState<PendingImageEdit | null>(null);
  const [dragStart, setDragStart] = useState<ScreenPoint | null>(null);
  const [dragCurrent, setDragCurrent] = useState<ScreenPoint | null>(null);
  const [isReplacingImage, setIsReplacingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

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
      const screenRect: ScreenRect = {
        x: spanRect.left - containerRect.left,
        y: spanRect.top - containerRect.top,
        width: spanRect.width,
        height: spanRect.height,
      };
      setTextValue(span.textContent);
      setTextEdit({ screenRect, originalText: span.textContent });
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
      const padding = 2;
      const p1 = await doc.screenPointToPdfPoint(
        pageNumber,
        scale,
        rotation,
        textEdit.screenRect.x - padding,
        textEdit.screenRect.y - padding,
      );
      const p2 = await doc.screenPointToPdfPoint(
        pageNumber,
        scale,
        rotation,
        textEdit.screenRect.x + textEdit.screenRect.width + padding,
        textEdit.screenRect.y + textEdit.screenRect.height + padding,
      );
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

  // --- Image edit: drag a rect (same gesture as the annotate "square" tool), then pick a replacement file.
  const localPoint = useCallback((e: ReactPointerEvent<HTMLDivElement>): ScreenPoint => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleFileChosen = useCallback(
    async (file: File) => {
      if (!imageEdit) return;
      const screenRect = imageEdit.screenRect;
      setImageEdit(null);
      const imageType = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : null;
      if (!imageType) {
        toast.error("Unsupported image type", "Choose a PNG or JPEG file.");
        return;
      }
      setIsReplacingImage(true);
      try {
        const imageBytes = new Uint8Array(await file.arrayBuffer());
        const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, screenRect.x, screenRect.y);
        const p2 = await doc.screenPointToPdfPoint(
          pageNumber,
          scale,
          rotation,
          screenRect.x + screenRect.width,
          screenRect.y + screenRect.height,
        );
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
    },
    [applyPdfMutation, doc, imageEdit, pageNumber, rotation, scale],
  );

  if (!editOpen) return null;

  return (
    <>
      {tool === "text" && textEdit && (
        <div
          role="dialog"
          aria-label="Replace text"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute z-20 flex w-72 flex-col gap-2 rounded-[--radius-md] border border-border-strong bg-surface p-3 text-sm shadow-[--shadow-floating]"
          style={{ left: textEdit.screenRect.x, top: textEdit.screenRect.y + textEdit.screenRect.height + 6 }}
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
            Covers the original text with a new text box — the underlying page content isn't rewritten.
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
      )}

      {tool === "image" && (
        <div
          ref={overlayRef}
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
            setImageEdit({ screenRect });
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
              className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10"
              style={{ left: imageEdit.screenRect.x, top: imageEdit.screenRect.y, width: imageEdit.screenRect.width, height: imageEdit.screenRect.height }}
            />
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
              else setImageEdit(null); // picker dismissed without choosing a file
            }}
          />
        </div>
      )}
    </>
  );
}
