import type { PdfDocument } from "@pdfloom/core";
import { Check, Loader2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLoomStore } from "../../app/store";

export interface SignaturePlaceOverlayProps {
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
const CORNER_HANDLES: HandleId[] = ["nw", "ne", "sw", "se"];
const EDGE_HANDLES: HandleId[] = ["n", "s", "e", "w"];
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

const BASE_HEIGHT: Record<string, number> = { signature: 56, initials: 42, date: 20, timestamp: 56 };
const MIN_WIDTH_PT = 24;
const MIN_HEIGHT_PT = 14;
const SNAP_PX = 6;
const TIMESTAMP_INK = "#1a1a1f";
const TIMESTAMP_FAINT = "#737378";
const TIMESTAMP_BORDER = "#8c8c94";

type DragMode =
  | { kind: "move"; startPointer: ScreenPoint; startRect: ScreenRect }
  | { kind: "resize"; handle: HandleId; startPointer: ScreenPoint; startRect: ScreenRect };

/**
 * Click to start a placement, then drag/resize/align it before it's baked
 * into the PDF — matches Acrobat's Fill & Sign adjustment step instead of
 * this app's older click-once-and-it's-permanent behavior. The in-progress
 * placement lives in pendingSignaturePlacement (store.ts); this overlay is
 * purely the interactive surface over it: start / move / resize / snap /
 * commit / cancel. Only one placement can be pending at a time (across all
 * pages) — a click on a page other than the pending one is a no-op rather
 * than silently discarding the in-progress adjustment.
 */
export function SignaturePlaceOverlay({ doc, pageNumber, scale, rotation }: SignaturePlaceOverlayProps) {
  const signOpen = useLoomStore((s) => s.signOpen);
  const kind = useLoomStore((s) => s.signPlacementKind);
  const activeSignature = useLoomStore((s) => s.activeSignature);
  const activeInitials = useLoomStore((s) => s.activeInitials);
  const signerName = useLoomStore((s) => s.signerName);
  const isPlacing = useLoomStore((s) => s.isPlacingSignature);
  const pending = useLoomStore((s) => s.pendingSignaturePlacement);
  const startSignaturePlacement = useLoomStore((s) => s.startSignaturePlacement);
  const updatePendingSignatureRect = useLoomStore((s) => s.updatePendingSignatureRect);
  const commitSignaturePlacement = useLoomStore((s) => s.commitSignaturePlacement);
  const cancelSignaturePlacement = useLoomStore((s) => s.cancelSignaturePlacement);

  const overlayRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  const [screenRect, setScreenRect] = useState<ScreenRect | null>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const pageIndex = pageNumber - 1;
  const activePending = pending && pending.pageIndex === pageIndex ? pending : null;
  const isImageAsset = activePending?.asset?.kind === "image";

  // Object URL for an image asset's live preview inside the draft box.
  useEffect(() => {
    const asset = activePending?.asset;
    if (!asset || asset.kind !== "image" || !asset.imageBytes) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([asset.imageBytes as BlobPart]));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePending?.asset]);

  // Projects the store's canonical PDF-space rect into screen space —
  // skipped mid-gesture so it doesn't fight the pointer-driven live value;
  // it catches back up the instant a gesture ends and the store updates.
  useEffect(() => {
    if (!activePending || dragMode) {
      if (!activePending) setScreenRect(null);
      return;
    }
    let cancelled = false;
    doc.pdfRectToScreenRect(pageNumber, scale, rotation, activePending.rect).then((rect) => {
      if (!cancelled) setScreenRect(rect);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, rotation, activePending?.rect.x, activePending?.rect.y, activePending?.rect.width, activePending?.rect.height, dragMode]);

  // Autofocus once the draft box actually mounts, so arrow-key nudging works
  // immediately without an extra click. Keyed on screenRect too (not just
  // activePending) — the draft <div> this ref points at only exists once
  // the async PDF->screen projection above has resolved at least once;
  // focusing right when activePending flips true would target a null ref.
  const isDraftMounted = !!activePending && !!screenRect;
  useEffect(() => {
    if (isDraftMounted) draftRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraftMounted]);

  const localPoint = useCallback((e: ReactPointerEvent): ScreenPoint => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const finalizeGesture = useCallback(
    async (finalRect: ScreenRect) => {
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, finalRect.x, finalRect.y);
      const p2 = await doc.screenPointToPdfPoint(
        pageNumber,
        scale,
        rotation,
        finalRect.x + finalRect.width,
        finalRect.y + finalRect.height,
      );
      updatePendingSignatureRect({
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      });
    },
    [doc, pageNumber, scale, rotation, updatePendingSignatureRect],
  );

  if (!signOpen || !kind) return null;

  const currentToolAsset = kind === "initials" ? activeInitials : kind === "signature" ? activeSignature : null;
  const needsAsset = kind === "signature" || kind === "initials";
  const canStartNewPlacement = !isPlacing && !pending && !(needsAsset && !currentToolAsset);
  const todayLabel = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const handleRootPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isPlacing) return;
    if (pending) {
      // Clicking empty page space while a placement is pending finalizes it
      // (matches "click away to finish" in Acrobat/design tools) rather
      // than starting a second one — only one placement is live at a time.
      if (activePending) void commitSignaturePlacement();
      return;
    }
    if (!canStartNewPlacement) return;
    e.preventDefault();
    const height = BASE_HEIGHT[kind] ?? 48;
    const width =
      currentToolAsset?.kind === "image" && currentToolAsset.aspectRatio
        ? height * currentToolAsset.aspectRatio
        : kind === "timestamp"
          ? 190
          : kind === "date"
            ? 130
            : height * 2.6;
    const p = localPoint(e);
    const screenX = p.x - width / 2;
    const screenY = p.y - height / 2;
    void (async () => {
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, screenX, screenY);
      const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, screenX + width, screenY + height);
      startSignaturePlacement(pageIndex, {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      });
    })();
  };

  const beginMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!screenRect || isPlacing) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    setDragMode({ kind: "move", startPointer: localPoint(e), startRect: screenRect });
  };

  const beginResize = (handle: HandleId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!screenRect || isPlacing) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode({ kind: "resize", handle, startPointer: localPoint(e), startRect: screenRect });
  };

  const handleDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragMode) return;
    e.preventDefault();
    const p = localPoint(e);
    const dx = p.x - dragMode.startPointer.x;
    const dy = p.y - dragMode.startPointer.y;
    const bounds = overlayRef.current!.getBoundingClientRect();
    const minW = MIN_WIDTH_PT * scale;
    const minH = MIN_HEIGHT_PT * scale;

    // Clamp to the intersection of the page's own bounds and the
    // currently-visible viewport, not just the page — a PDF page is
    // routinely taller than the browser window at any real zoom level, and
    // a draft (or its own resize handles) dragged below the visible fold
    // becomes physically unreachable without scrolling first. EDGE_MARGIN
    // keeps a handle's hit-circle (centered exactly on the draft's edge)
    // off the viewport's boundary pixel, which is outside hit-testing range.
    const EDGE_MARGIN = 10;
    const visibleMinX = Math.max(0, -bounds.left) + EDGE_MARGIN;
    const visibleMaxX = Math.min(bounds.width, window.innerWidth - bounds.left) - EDGE_MARGIN;
    const visibleMinY = Math.max(0, -bounds.top) + EDGE_MARGIN;
    const visibleMaxY = Math.min(bounds.height, window.innerHeight - bounds.top) - EDGE_MARGIN;

    if (dragMode.kind === "move") {
      let x = dragMode.startRect.x + dx;
      let y = dragMode.startRect.y + dy;
      x = Math.min(Math.max(visibleMinX, x), Math.max(visibleMinX, visibleMaxX - dragMode.startRect.width));
      y = Math.min(Math.max(visibleMinY, y), Math.max(visibleMinY, visibleMaxY - dragMode.startRect.height));

      const centerX = x + dragMode.startRect.width / 2;
      const centerY = y + dragMode.startRect.height / 2;
      const pageCenterX = bounds.width / 2;
      const pageCenterY = bounds.height / 2;
      let snapX: number | null = null;
      let snapY: number | null = null;
      if (Math.abs(centerX - pageCenterX) < SNAP_PX) {
        x = pageCenterX - dragMode.startRect.width / 2;
        snapX = pageCenterX;
      }
      if (Math.abs(centerY - pageCenterY) < SNAP_PX) {
        y = pageCenterY - dragMode.startRect.height / 2;
        snapY = pageCenterY;
      }
      setSnapGuides({ x: snapX, y: snapY });
      setScreenRect({ x, y, width: dragMode.startRect.width, height: dragMode.startRect.height });
      return;
    }

    const spec = HANDLE_SPEC[dragMode.handle];

    if (isImageAsset && activePending?.asset?.aspectRatio) {
      const ratio = activePending.asset.aspectRatio;
      const growSign = spec.right ? 1 : -1; // corner handles only for aspect-locked assets — always left or right
      let newWidth = Math.max(minW, dragMode.startRect.width + growSign * dx);
      let newHeight = newWidth / ratio;
      if (newHeight < minH) {
        newHeight = minH;
        newWidth = newHeight * ratio;
      }
      let x = dragMode.startRect.x;
      let y = dragMode.startRect.y;
      if (spec.left) x = dragMode.startRect.x + (dragMode.startRect.width - newWidth);
      if (spec.top) y = dragMode.startRect.y + (dragMode.startRect.height - newHeight);
      x = Math.min(Math.max(visibleMinX, x), Math.max(visibleMinX, visibleMaxX - newWidth));
      y = Math.min(Math.max(visibleMinY, y), Math.max(visibleMinY, visibleMaxY - newHeight));
      setScreenRect({ x, y, width: newWidth, height: newHeight });
      return;
    }

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

    if (width < minW) {
      if (spec.left) x -= minW - width;
      width = minW;
    }
    if (height < minH) {
      if (spec.top) y -= minH - height;
      height = minH;
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

    setScreenRect({ x, y, width, height });
  };

  const handleDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragMode || !screenRect) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragMode(null);
    setSnapGuides({ x: null, y: null });
    void finalizeGesture(screenRect);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelSignaturePlacement();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void commitSignaturePlacement();
      return;
    }
    if (!activePending) return;
    const nudge = e.shiftKey ? 10 : 1; // PDF points
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -1;
    else if (e.key === "ArrowRight") dx = 1;
    else if (e.key === "ArrowUp") dy = -1;
    else if (e.key === "ArrowDown") dy = 1;
    else return;
    e.preventDefault();
    updatePendingSignatureRect({
      ...activePending.rect,
      x: activePending.rect.x + dx * nudge,
      // Screen Y grows downward, PDF Y grows upward — flip the sign.
      y: activePending.rect.y - dy * nudge,
    });
  };

  const handles = isImageAsset ? CORNER_HANDLES : [...CORNER_HANDLES, ...EDGE_HANDLES];

  // Rough shrink-to-fit for the live Caveat-font preview so a short, wide
  // box doesn't visibly clip the text — the actual baked placement (see
  // packages/core/src/pdf/signature.ts) does its own exact fit via
  // font.widthOfTextAtSize, this just needs to look right while dragging.
  const fitFontSize = (text: string, rect: ScreenRect, maxByHeight: number) =>
    Math.max(6, Math.min(maxByHeight, rect.height * 0.7, ((rect.width - 12) / Math.max(1, text.length)) * 1.8));

  return (
    <div
      ref={overlayRef}
      className={`absolute inset-0 z-10 touch-none ${
        canStartNewPlacement ? "cursor-crosshair" : pending && !activePending ? "cursor-not-allowed" : "cursor-default"
      }`}
      onPointerDown={handleRootPointerDown}
    >
      {activePending && screenRect && (
        <>
          {snapGuides.x !== null && (
            <div className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: snapGuides.x }} />
          )}
          {snapGuides.y !== null && (
            <div className="pointer-events-none absolute inset-x-0 h-px bg-primary" style={{ top: snapGuides.y }} />
          )}

          <div
            ref={draftRef}
            tabIndex={0}
            onPointerDown={beginMove}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            onKeyDown={handleKeyDown}
            className="absolute touch-none cursor-move rounded-[2px] outline-none ring-2 ring-primary"
            style={{ left: screenRect.x, top: screenRect.y, width: screenRect.width, height: screenRect.height }}
          >
            <div className="pointer-events-none flex h-full w-full items-center justify-center overflow-hidden">
              {activePending.asset?.kind === "image" && previewUrl && (
                <img src={previewUrl} alt="" className="h-full w-full object-contain" />
              )}
              {activePending.asset?.kind === "typed" && (
                <span
                  className="whitespace-nowrap px-1"
                  style={{
                    fontFamily: "'Caveat', cursive",
                    color: "#0d0d33",
                    fontSize: fitFontSize(activePending.asset.text ?? "", screenRect, 64),
                  }}
                >
                  {activePending.asset.text}
                </span>
              )}
              {activePending.kind === "date" && (
                <span
                  className="whitespace-nowrap px-1"
                  style={{ fontFamily: "'Caveat', cursive", color: "#1a1a1f", fontSize: fitFontSize(todayLabel, screenRect, 48) }}
                >
                  {todayLabel}
                </span>
              )}
              {activePending.kind === "timestamp" && (
                <div
                  className="flex h-full w-full flex-col justify-start gap-0.5 overflow-hidden px-1.5 py-1 text-left"
                  style={{ border: `1px solid ${TIMESTAMP_BORDER}` }}
                >
                  <span className="truncate font-bold" style={{ color: TIMESTAMP_INK, fontSize: Math.min(screenRect.height * 0.26, 11) }}>
                    Signed by {signerName.trim() || "Unnamed signer"}
                  </span>
                  <span className="truncate" style={{ color: TIMESTAMP_FAINT, fontSize: Math.min(screenRect.height * 0.2, 9) }}>
                    {todayLabel}
                  </span>
                </div>
              )}
            </div>

            {!isPlacing &&
              handles.map((h) => (
                <div
                  key={h}
                  onPointerDown={beginResize(h)}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                  className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary bg-white shadow ${HANDLE_CURSOR[h]}`}
                  style={{ left: HANDLE_POSITION[h].left, top: HANDLE_POSITION[h].top }}
                />
              ))}

            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-strong bg-surface px-1.5 py-1 shadow-[--shadow-floating]"
              style={{ top: screenRect.y > 40 ? -38 : screenRect.height + 6 }}
            >
              {isPlacing ? (
                <Loader2 className="h-4 w-4 animate-spin text-text-faint" />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void commitSignaturePlacement()}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-text hover:opacity-90"
                    aria-label="Place here"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelSignaturePlacement()}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-bg text-text-muted hover:text-text"
                    aria-label="Cancel placement"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
