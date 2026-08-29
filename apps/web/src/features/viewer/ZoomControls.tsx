import { IconButton, Tooltip } from "@pdfloom/ui";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useLoomStore } from "../../app/store";

export function ZoomControls() {
  const zoom = useLoomStore((s) => s.zoom);
  const fitMode = useLoomStore((s) => s.fitMode);
  const fitWidthScale = useLoomStore((s) => s.fitWidthScale);
  const zoomIn = useLoomStore((s) => s.zoomIn);
  const zoomOut = useLoomStore((s) => s.zoomOut);
  const setFitMode = useLoomStore((s) => s.setFitMode);

  const effectiveScale = fitMode === "width" ? fitWidthScale : zoom;
  const percent = Math.round(effectiveScale * 100);

  return (
    <div className="flex items-center gap-0.5 rounded-[--radius-md] border border-border bg-surface px-0.5">
      <IconButton icon={<Minus />} label="Zoom out" size="sm" onClick={zoomOut} shortcut="Ctrl -" />
      <Tooltip content={fitMode === "width" ? "Fit to width" : "Set custom zoom"} shortcut="Ctrl 0">
        <button
          type="button"
          onClick={() => setFitMode(fitMode === "width" ? "custom" : "width")}
          className="min-w-[3.25rem] px-1 text-center text-xs font-medium tabular-nums text-text-muted hover:text-text"
        >
          {percent}%
        </button>
      </Tooltip>
      <IconButton icon={<Plus />} label="Zoom in" size="sm" onClick={zoomIn} shortcut="Ctrl +" />
      <IconButton
        icon={<Maximize2 />}
        label="Fit to width"
        size="sm"
        variant={fitMode === "width" ? "active" : "default"}
        onClick={() => setFitMode("width")}
      />
    </div>
  );
}
