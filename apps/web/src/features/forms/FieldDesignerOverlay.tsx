import { getPdfWorkerClient, type PdfDocument } from "@pdfloom/core";
import { Button, toast } from "@pdfloom/ui";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLoomStore, type FieldDesignTool } from "../../app/store";

export interface FieldDesignerOverlayProps {
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

// Default on-page footprint for a freshly click-placed field, in PDF
// points — sized to be immediately usable without a resize step, matching
// how Acrobat's own "Prepare Form" auto-sizes a clicked field. The box
// stays fully adjustable afterward (see below) for whenever the default
// doesn't fit a specific form line.
const FIELD_SIZE: Record<FieldDesignTool, { width: number; height: number }> = {
  text: { width: 180, height: 22 },
  checkbox: { width: 18, height: 18 },
  radio: { width: 18, height: 18 },
  dropdown: { width: 160, height: 22 },
};
const MIN_FIELD_PX = 14;
const EDGE_MARGIN = 10;

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

interface PendingField {
  tool: FieldDesignTool;
  rect: ScreenRect;
}

/**
 * Click-to-place field designer: clicking the page with a field tool
 * selected drops an adjustable draft box at a default size — draggable by
 * its own body and resizable via 8 handles, exactly like the signature/
 * comment-box/redaction overlays, so a field can be lined up with a
 * specific form line before it's created — alongside a small inline form
 * asking for the field's name (and type-specific options); the real
 * AcroForm field is created via the worker at the draft's *current*
 * (possibly adjusted) position/size once that form is submitted. Radio
 * stays sticky on the last-used group name so adding a group's options is
 * a quick series of clicks, not a dialog per option — addRadioOption
 * creates the group on the first click and extends it on every click after.
 */
export function FieldDesignerOverlay({ doc, pageNumber, scale, rotation }: FieldDesignerOverlayProps) {
  const formFillOpen = useLoomStore((s) => s.formFillOpen);
  const formMode = useLoomStore((s) => s.formMode);
  const tool = useLoomStore((s) => s.formDesignTool);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);
  const refreshFormFields = useLoomStore((s) => s.refreshFormFields);

  const overlayRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingField | null>(null);
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState(""); // default value (text) / options csv (dropdown) / option label (radio)
  const [multiline, setMultiline] = useState(false);
  const [defaultChecked, setDefaultChecked] = useState(false);
  const [lastRadioGroup, setLastRadioGroup] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);

  const resetPendingForm = () => {
    setPending(null);
    setDragMode(null);
    setName("");
    setExtra("");
    setMultiline(false);
    setDefaultChecked(false);
  };

  const commit = async () => {
    if (!pending) return;
    const fieldName = name.trim();
    if (!fieldName) return;
    setIsPlacing(true);
    try {
      const { rect: r } = pending;
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, r.x, r.y);
      const p2 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, r.x + r.width, r.y + r.height);
      const rect = {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      };
      const pageIndex = pageNumber - 1;
      const client = await getPdfWorkerClient();
      const bytes = await doc.getRawBytes();

      let result: Uint8Array;
      if (pending.tool === "text") {
        result = await client.createTextField(bytes, { name: fieldName, pageIndex, rect, defaultValue: extra || undefined, multiline });
      } else if (pending.tool === "checkbox") {
        result = await client.createCheckBox(bytes, { name: fieldName, pageIndex, rect, defaultChecked });
      } else if (pending.tool === "dropdown") {
        const options = extra
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
        if (options.length === 0) {
          toast.error("Add at least one option", "Separate options with commas.");
          setIsPlacing(false);
          return;
        }
        result = await client.createDropdown(bytes, { name: fieldName, pageIndex, rect, options });
      } else {
        const label = extra.trim();
        if (!label) {
          toast.error("Enter an option label", "e.g. \"Small\" for this radio button.");
          setIsPlacing(false);
          return;
        }
        result = await client.addRadioOption(bytes, { name: fieldName, pageIndex, rect, label });
        setLastRadioGroup(fieldName);
      }

      await applyPdfMutation(result);
      await refreshFormFields();
      toast.success(`Added "${fieldName}" field`);
      resetPendingForm();
    } catch (error) {
      toast.error("Couldn't add field", error instanceof Error ? error.message : undefined);
    } finally {
      setIsPlacing(false);
    }
  };

  const localPoint = (e: ReactPointerEvent<HTMLDivElement>): ScreenPoint => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const beginMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pending) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode({ kind: "move", startPointer: localPoint(e), startRect: pending.rect });
  };

  const beginResize = (handle: HandleId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pending) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode({ kind: "resize", handle, startPointer: localPoint(e), startRect: pending.rect });
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
    // AnnotationDrawOverlay/RedactOverlay for the full rationale.
    const visibleMinX = Math.max(0, -bounds.left) + EDGE_MARGIN;
    const visibleMaxX = Math.min(bounds.width, window.innerWidth - bounds.left) - EDGE_MARGIN;
    const visibleMinY = Math.max(0, -bounds.top) + EDGE_MARGIN;
    const visibleMaxY = Math.min(bounds.height, window.innerHeight - bounds.top) - EDGE_MARGIN;

    if (dragMode.kind === "move") {
      let x = dragMode.startRect.x + dx;
      let y = dragMode.startRect.y + dy;
      x = Math.min(Math.max(visibleMinX, x), Math.max(visibleMinX, visibleMaxX - dragMode.startRect.width));
      y = Math.min(Math.max(visibleMinY, y), Math.max(visibleMinY, visibleMaxY - dragMode.startRect.height));
      setPending((prev) => (prev ? { ...prev, rect: { x, y, width: dragMode.startRect.width, height: dragMode.startRect.height } } : prev));
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

    if (width < MIN_FIELD_PX) {
      if (spec.left) x -= MIN_FIELD_PX - width;
      width = MIN_FIELD_PX;
    }
    if (height < MIN_FIELD_PX) {
      if (spec.top) y -= MIN_FIELD_PX - height;
      height = MIN_FIELD_PX;
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

    setPending((prev) => (prev ? { ...prev, rect: { x, y, width, height } } : prev));
  };

  const handleDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragMode) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragMode(null);
  };

  if (!formFillOpen || formMode !== "design" || !tool) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 cursor-crosshair"
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (pending) return; // finish (or cancel) the current field first
        const point = localPoint(e);
        const size = FIELD_SIZE[tool];
        setPending({ tool, rect: { x: point.x, y: point.y, width: size.width, height: size.height } });
        setName(tool === "radio" ? lastRadioGroup : "");
        setExtra("");
      }}
    >
      {pending && (
        <>
          <div
            onPointerDown={beginMove}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            className="absolute cursor-move border-2 border-dashed border-primary bg-primary/10"
            style={{ left: pending.rect.x, top: pending.rect.y, width: pending.rect.width, height: pending.rect.height }}
          >
            {RESIZE_HANDLES.map((h) => (
              <div
                key={h}
                onPointerDown={beginResize(h)}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow ${HANDLE_CURSOR[h]}`}
                style={{ left: HANDLE_POSITION[h].left, top: HANDLE_POSITION[h].top }}
              />
            ))}
          </div>

          <div
            role="dialog"
            aria-label="New form field"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute z-20 flex w-64 flex-col gap-2 rounded-[--radius-md] border border-border-strong bg-surface p-3 text-sm shadow-[--shadow-floating]"
            style={{ left: pending.rect.x, top: pending.rect.y + pending.rect.height + 8 }}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">
              {pending.tool === "radio" ? "Radio option" : `New ${pending.tool} field`}
            </span>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-faint">{pending.tool === "radio" ? "Group name" : "Field name"}</span>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={pending.tool === "radio" ? "e.g. size" : "e.g. fullName"}
                className="h-8 rounded-[--radius-sm] border border-border-strong bg-bg px-2 text-text outline-none focus-visible:border-primary"
              />
            </label>

            {pending.tool === "text" && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-text-faint">Default value (optional)</span>
                  <input
                    type="text"
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    className="h-8 rounded-[--radius-sm] border border-border-strong bg-bg px-2 text-text outline-none focus-visible:border-primary"
                  />
                </label>
                <label className="flex items-center gap-2 text-text-faint">
                  <input type="checkbox" checked={multiline} onChange={(e) => setMultiline(e.target.checked)} />
                  Multiline
                </label>
              </>
            )}

            {pending.tool === "checkbox" && (
              <label className="flex items-center gap-2 text-text-faint">
                <input type="checkbox" checked={defaultChecked} onChange={(e) => setDefaultChecked(e.target.checked)} />
                Checked by default
              </label>
            )}

            {pending.tool === "dropdown" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-faint">Options (comma-separated)</span>
                <input
                  type="text"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="USA, Canada, UK"
                  className="h-8 rounded-[--radius-sm] border border-border-strong bg-bg px-2 text-text outline-none focus-visible:border-primary"
                />
              </label>
            )}

            {pending.tool === "radio" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-faint">Option label</span>
                <input
                  type="text"
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="e.g. Small"
                  className="h-8 rounded-[--radius-sm] border border-border-strong bg-bg px-2 text-text outline-none focus-visible:border-primary"
                />
              </label>
            )}

            <p className="text-[11px] leading-snug text-text-faint">Drag the box's edges to resize it, or its middle to move it.</p>

            <div className="mt-1 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={resetPendingForm} disabled={isPlacing}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => void commit()} disabled={isPlacing || !name.trim()}>
                {isPlacing ? "Adding…" : "Add field"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
