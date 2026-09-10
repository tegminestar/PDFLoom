import { Button } from "@pdfloom/ui";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 160;

export interface SignatureCaptureModalProps {
  /** "signature" | "initials" — only affects copy, capture mechanics are identical. */
  kind: "signature" | "initials";
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

/**
 * Draw or type a signature/initials, shared between the owner's self-sign
 * flow and a recipient's signing page — extracted from what used to be
 * SignerPage's inline canvas logic so both places (and any future one)
 * capture the same way instead of drifting into two slightly different
 * implementations.
 */
export function SignatureCaptureModal({ kind, onCapture, onClose }: SignatureCaptureModalProps) {
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typedText, setTypedText] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const ensureCanvasInit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (canvas.width !== CANVAS_WIDTH * 2) {
      canvas.width = CANVAS_WIDTH * 2;
      canvas.height = CANVAS_HEIGHT * 2;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(2, 2);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#141414";
        ctx.lineWidth = 2.5;
      }
    }
    return canvas.getContext("2d");
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const ctx = ensureCanvasInit();
    if (!ctx || !canvasRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvasRef.current.getBoundingClientRect();
    lastPointRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDrawingRef.current = true;
    setHasDrawn(true);
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx || !lastPointRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  };
  const handlePointerUp = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };
  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleUse = () => {
    if (tab === "draw") {
      if (!hasDrawn || !canvasRef.current) return;
      onCapture(canvasRef.current.toDataURL("image/png"));
      return;
    }
    if (!typedText.trim()) return;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH * 2;
    canvas.height = CANVAS_HEIGHT * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.font = "48px cursive";
    ctx.fillStyle = "#141414";
    ctx.textBaseline = "middle";
    ctx.fillText(typedText.trim(), 12, CANVAS_HEIGHT / 2);
    onCapture(canvas.toDataURL("image/png"));
  };

  const canUse = tab === "draw" ? hasDrawn : typedText.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[--color-overlay] p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-[--radius-lg] border border-border-strong bg-bg-elevated p-5 shadow-[--shadow-floating]">
        <h2 className="text-sm font-semibold text-text">{kind === "signature" ? "Draw or type your signature" : "Draw or type your initials"}</h2>
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          {(["draw", "type"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium capitalize transition-colors ${tab === t ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "draw" ? (
          <div className="flex flex-col gap-2">
            <canvas
              ref={canvasRef}
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
              className="cursor-crosshair touch-none self-center rounded-[--radius-sm] border border-border-strong bg-white"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={!hasDrawn} className="self-start">
              Clear
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              autoFocus
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="Type your name"
              className="h-10 rounded-[--radius-sm] border border-border-strong bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
            />
            <div
              className="flex items-center justify-center rounded-[--radius-sm] border border-border-strong bg-white px-4"
              style={{ height: CANVAS_HEIGHT, fontFamily: "'Caveat', cursive" }}
            >
              <span className="text-5xl text-[#141414]">{typedText || "Preview"}</span>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!canUse} onClick={handleUse}>
            Use this {kind === "signature" ? "signature" : "initials"}
          </Button>
        </div>
      </div>
    </div>
  );
}
