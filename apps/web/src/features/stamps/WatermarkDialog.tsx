import { getPdfWorkerClient } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

export function WatermarkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [text, setText] = useState("DRAFT");
  const [layout, setLayout] = useState<"center" | "tile">("tile");
  const [fontSize, setFontSize] = useState(48);
  const [opacity, setOpacity] = useState(0.2);
  const [rotation, setRotation] = useState(-45);
  const [isApplying, setIsApplying] = useState(false);

  const handleApply = async () => {
    if (!doc || !text.trim()) return;
    setIsApplying(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await client.addTextWatermark(await doc.getRawBytes(), {
        text: text.trim(),
        layout,
        fontSize,
        opacity,
        rotation,
        color: { r: 0.5, g: 0.5, b: 0.5 },
      });
      await applyPdfMutation(bytes);
      toast.success("Watermark added");
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't add watermark", error instanceof Error ? error.message : undefined);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add watermark"
      description="Stamped onto every page as permanent page content."
      width={440}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!text.trim() || isApplying} onClick={() => void handleApply()}>
            {isApplying ? "Applying…" : "Add watermark"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-text">
          Text
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
          />
        </label>

        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          <button
            type="button"
            onClick={() => setLayout("tile")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${layout === "tile" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Tiled
          </button>
          <button
            type="button"
            onClick={() => setLayout("center")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${layout === "center" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Centered
          </button>
        </div>

        <label className="flex items-center justify-between gap-2 text-sm text-text">
          Font size
          <input
            type="number"
            min={8}
            max={200}
            value={fontSize}
            onChange={(e) => setFontSize(Number.parseInt(e.target.value, 10) || 48)}
            className="h-8 w-20 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-right outline-none"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-text">
          Opacity
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number.parseFloat(e.target.value))}
            className="w-40"
          />
          <span className="w-10 text-right text-xs text-text-faint">{Math.round(opacity * 100)}%</span>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-text">
          Rotation
          <input
            type="range"
            min={-90}
            max={90}
            step={5}
            value={rotation}
            onChange={(e) => setRotation(Number.parseInt(e.target.value, 10))}
            className="w-40"
          />
          <span className="w-10 text-right text-xs text-text-faint">{rotation}°</span>
        </label>
      </div>
    </Dialog>
  );
}
