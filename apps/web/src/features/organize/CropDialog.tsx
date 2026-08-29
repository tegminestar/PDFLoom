import { getPdfWorkerClient } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "../../app/store";

const PREVIEW_SCALE = 0.6;

export function CropDialog({
  open,
  onOpenChange,
  pageNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageNumber: number;
}) {
  const doc = useLoomStore((s) => s.document);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<{ widthPt: number; heightPt: number } | null>(null);
  const [margins, setMargins] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (!open || !doc) return;
    setMargins({ top: 0, right: 0, bottom: 0, left: 0 });
    doc.getPageDimensions(pageNumber).then(setDims);
  }, [open, doc, pageNumber]);

  useEffect(() => {
    if (!open || !doc || !dims || !canvasRef.current) return;
    void doc.renderPage(pageNumber, { canvas: canvasRef.current, scale: PREVIEW_SCALE });
  }, [open, doc, dims, pageNumber]);

  if (!dims) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title="Crop page">
        <p className="text-sm text-text-muted">Loading page…</p>
      </Dialog>
    );
  }

  const previewWidth = dims.widthPt * PREVIEW_SCALE;
  const previewHeight = dims.heightPt * PREVIEW_SCALE;
  const maxMarginPt = { x: dims.widthPt / 2 - 1, y: dims.heightPt / 2 - 1 };

  const setMargin = (key: keyof typeof margins, value: number) => {
    const max = key === "left" || key === "right" ? maxMarginPt.x : maxMarginPt.y;
    setMargins((prev) => ({ ...prev, [key]: Math.max(0, Math.min(max, value)) }));
  };

  const handleApply = async () => {
    if (!doc) return;
    setIsApplying(true);
    try {
      const bytes = await doc.getRawBytes();
      const client = await getPdfWorkerClient();
      const box = {
        x: margins.left,
        y: margins.bottom,
        width: dims.widthPt - margins.left - margins.right,
        height: dims.heightPt - margins.top - margins.bottom,
      };
      const newBytes = await client.cropPages(bytes, [pageNumber - 1], box);
      await applyPdfMutation(newBytes);
      toast.success(`Cropped page ${pageNumber}`);
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't crop this page", error instanceof Error ? error.message : undefined);
    } finally {
      setIsApplying(false);
    }
  };

  const marginField = (label: string, key: keyof typeof margins) => (
    <label className="flex items-center justify-between gap-2 text-sm text-text">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={Math.round(margins[key])}
          onChange={(e) => setMargin(key, Number.parseFloat(e.target.value) || 0)}
          className="h-8 w-20 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-right outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
        />
        <span className="text-xs text-text-faint">pt</span>
      </span>
    </label>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Crop page ${pageNumber}`}
      description="Set margins to trim from each edge, in PDF points (72pt = 1 inch)."
      width={520}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={isApplying} onClick={() => void handleApply()}>
            {isApplying ? "Cropping…" : "Apply crop"}
          </Button>
        </>
      }
    >
      <div className="flex gap-5">
        <div className="relative shrink-0 bg-canvas shadow-[0_1px_4px_var(--loom-canvas-shadow)]" style={{ width: previewWidth, height: previewHeight }}>
          <canvas ref={canvasRef} className="block" />
          {/* Darkened mask over the region that will be cropped away. */}
          <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: margins.top * PREVIEW_SCALE }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: margins.bottom * PREVIEW_SCALE }} />
          <div
            className="absolute left-0 bg-black/55"
            style={{ top: margins.top * PREVIEW_SCALE, bottom: margins.bottom * PREVIEW_SCALE, width: margins.left * PREVIEW_SCALE }}
          />
          <div
            className="absolute right-0 bg-black/55"
            style={{ top: margins.top * PREVIEW_SCALE, bottom: margins.bottom * PREVIEW_SCALE, width: margins.right * PREVIEW_SCALE }}
          />
          <div
            className="pointer-events-none absolute border-2 border-ai"
            style={{
              top: margins.top * PREVIEW_SCALE,
              left: margins.left * PREVIEW_SCALE,
              right: margins.right * PREVIEW_SCALE,
              bottom: margins.bottom * PREVIEW_SCALE,
            }}
          />
        </div>
        <div className="flex flex-1 flex-col gap-3">
          {marginField("Top", "top")}
          {marginField("Right", "right")}
          {marginField("Bottom", "bottom")}
          {marginField("Left", "left")}
        </div>
      </div>
    </Dialog>
  );
}
