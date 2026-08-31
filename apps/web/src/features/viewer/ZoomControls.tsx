import { IconButton, Tooltip } from "@pdfloom/ui";
import { Maximize, Maximize2, Minus, Plus } from "lucide-react";
import { useLoomStore } from "../../app/store";

export function ZoomControls() {
  const zoom = useLoomStore((s) => s.zoom);
  const fitMode = useLoomStore((s) => s.fitMode);
  const fitWidthScale = useLoomStore((s) => s.fitWidthScale);
  const fitPageScale = useLoomStore((s) => s.fitPageScale);
  const zoomIn = useLoomStore((s) => s.zoomIn);
  const zoomOut = useLoomStore((s) => s.zoomOut);
  const setFitMode = useLoomStore((s) => s.setFitMode);

  const effectiveScale = fitMode === "width" ? fitWidthScale : fitMode === "page" ? fitPageScale : zoom;
  const percent = Math.round(effectiveScale * 100);
  const fitLabel = fitMode === "width" ? "Fit to width" : fitMode === "page" ? "Fit to page" : "Set custom zoom";

  return (
    <div className="flex items-center gap-0.5 rounded-[--radius-md] border border-border bg-surface px-0.5">
      <IconButton icon={<Minus />} label="Zoom out" size="sm" onClick={zoomOut} shortcut="Ctrl -" />
      <Tooltip content={fitLabel} shortcut="Ctrl 0">
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
      <IconButton
        icon={<Maximize />}
        label="Fit to page"
        size="sm"
        variant={fitMode === "page" ? "active" : "default"}
        onClick={() => setFitMode("page")}
      />
    </div>
  );
}
