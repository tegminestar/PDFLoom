import { getPdfWorkerClient, type PdfDocument } from "@pdfloom/core";
import { Button, toast } from "@pdfloom/ui";
import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";
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

// Default on-page footprint for a click-placed field, in PDF points — sized
// to be immediately usable without a resize step, matching how Acrobat's
// own "Prepare Form" auto-sizes a clicked field.
const FIELD_SIZE: Record<FieldDesignTool, { width: number; height: number }> = {
  text: { width: 180, height: 22 },
  checkbox: { width: 18, height: 18 },
  radio: { width: 18, height: 18 },
  dropdown: { width: 160, height: 22 },
};

interface PendingField {
  tool: FieldDesignTool;
  screenPoint: ScreenPoint;
}

/**
 * Click-to-place field designer: clicking the page with a field tool
 * selected drops a small inline form asking for the field's name (and
 * type-specific options), then creates the real AcroForm field via the
 * worker at that position. Radio stays sticky on the last-used group name
 * so adding a group's options is a quick series of clicks, not a dialog per
 * option — addRadioOption creates the group on the first click and extends
 * it on every click after.
 */
export function FieldDesignerOverlay({ doc, pageNumber, scale, rotation }: FieldDesignerOverlayProps) {
  const formFillOpen = useLoomStore((s) => s.formFillOpen);
  const formMode = useLoomStore((s) => s.formMode);
  const tool = useLoomStore((s) => s.formDesignTool);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);
  const refreshFormFields = useLoomStore((s) => s.refreshFormFields);

  const [pending, setPending] = useState<PendingField | null>(null);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState(""); // default value (text) / options csv (dropdown) / option label (radio)
  const [multiline, setMultiline] = useState(false);
  const [defaultChecked, setDefaultChecked] = useState(false);
  const [lastRadioGroup, setLastRadioGroup] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);

  const resetPendingForm = useCallback(() => {
    setPending(null);
    setName("");
    setExtra("");
    setMultiline(false);
    setDefaultChecked(false);
  }, []);

  const commit = useCallback(async () => {
    if (!pending) return;
    const fieldName = name.trim();
    if (!fieldName) return;
    setIsPlacing(true);
    try {
      const size = FIELD_SIZE[pending.tool];
      const p1 = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, pending.screenPoint.x, pending.screenPoint.y);
      const p2 = await doc.screenPointToPdfPoint(
        pageNumber,
        scale,
        rotation,
        pending.screenPoint.x + size.width,
        pending.screenPoint.y + size.height,
      );
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
  }, [applyPdfMutation, defaultChecked, doc, extra, multiline, name, pageNumber, pending, refreshFormFields, resetPendingForm, rotation, scale]);

  if (!formFillOpen || formMode !== "design" || !tool) return null;

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (pending) return; // finish (or cancel) the current field first
        const target = e.currentTarget.getBoundingClientRect();
        const point = { x: e.clientX - target.left, y: e.clientY - target.top };
        setPending({ tool, screenPoint: point });
        setName(tool === "radio" ? lastRadioGroup : "");
        setExtra("");
      }}
    >
      {pending && (
        <div
          role="dialog"
          aria-label="New form field"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute z-20 flex w-64 flex-col gap-2 rounded-[--radius-md] border border-border-strong bg-surface p-3 text-sm shadow-[--shadow-floating]"
          style={{ left: pending.screenPoint.x, top: pending.screenPoint.y + 28 }}
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

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={resetPendingForm} disabled={isPlacing}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void commit()} disabled={isPlacing || !name.trim()}>
              {isPlacing ? "Adding…" : "Add field"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
