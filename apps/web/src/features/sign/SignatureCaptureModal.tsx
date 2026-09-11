import { Button } from "@pdfloom/ui";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { getSavedSignatureDataUrl, setSavedSignatureDataUrl } from "./signatureStorage";

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 160;

const INK_COLORS = [
  { id: "black", label: "Black", hex: "#141414" },
  { id: "blue", label: "Blue", hex: "#1a56db" },
  { id: "navy", label: "Navy", hex: "#1e3a5f" },
  { id: "red", label: "Red", hex: "#c92a2a" },
] as const;

const TYPE_STYLES = [
  { id: "caveat", label: "Caveat", fontFamily: "'Caveat', cursive" },
  { id: "dancing-script", label: "Dancing Script", fontFamily: "'Dancing Script', cursive" },
  { id: "sacramento", label: "Sacramento", fontFamily: "'Sacramento', cursive" },
  { id: "pacifico", label: "Pacifico", fontFamily: "'Pacifico', cursive" },
] as const;

export interface SignatureCaptureModalProps {
  /** "signature" | "initials" — only affects copy, capture mechanics are identical. */
  kind: "signature" | "initials";
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

/**
 * Draw, type, or upload a signature/initials — used by a recipient's
 * signing page (SignerPage). The owner's own self-sign flow has a separate,
 * older implementation (SignatureCreatorDialog) predating this one; the two
 * share the save-for-reuse mechanism (signatureStorage.ts) but each keeps
 * its own capture UI since SignatureCreatorDialog's typed signatures are
 * placed as real vector text (packages/core/src/pdf/signature.ts), not the
 * rasterized image this modal always produces.
 */
export function SignatureCaptureModal({ kind, onCapture, onClose }: SignatureCaptureModalProps) {
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [typedText, setTypedText] = useState("");
  const [typeStyle, setTypeStyle] = useState<(typeof TYPE_STYLES)[number]>(TYPE_STYLES[0]);
  const [color, setColor] = useState<(typeof INK_COLORS)[number]>(INK_COLORS[0]);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const [saveForReuse, setSaveForReuse] = useState(true);
  const [savedAsset, setSavedAssetState] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSavedAssetState(getSavedSignatureDataUrl(kind));
  }, [kind]);

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
    ctx.strokeStyle = color.hex;
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

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUploadedDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const renderTypedSignature = async (): Promise<string> => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH * 2;
    canvas.height = CANVAS_HEIGHT * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    const font = `48px ${typeStyle.fontFamily}`;
    // Canvas text doesn't wait for webfonts the way DOM text does — without
    // this, the very first render after picking a style can silently fall
    // back to the default serif/sans font for one frame (or permanently, on
    // a slow connection), baking the wrong font into the captured image.
    await document.fonts.load(font, typedText.trim());
    ctx.font = font;
    ctx.fillStyle = color.hex;
    ctx.textBaseline = "middle";
    ctx.fillText(typedText.trim(), 12, CANVAS_HEIGHT / 2);
    return canvas.toDataURL("image/png");
  };

  const finishCapture = (dataUrl: string) => {
    if (saveForReuse) setSavedSignatureDataUrl(kind, dataUrl);
    onCapture(dataUrl);
  };

  const handleUse = async () => {
    if (tab === "draw") {
      if (!hasDrawn || !canvasRef.current) return;
      finishCapture(canvasRef.current.toDataURL("image/png"));
      return;
    }
    if (tab === "upload") {
      if (!uploadedDataUrl) return;
      finishCapture(uploadedDataUrl);
      return;
    }
    if (!typedText.trim()) return;
    finishCapture(await renderTypedSignature());
  };

  const canUse = tab === "draw" ? hasDrawn : tab === "upload" ? uploadedDataUrl !== null : typedText.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-(--color-overlay) p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-(--radius-lg) border border-border-strong bg-bg-elevated p-5 shadow-(--shadow-floating)">
        <h2 className="text-sm font-semibold text-text">{kind === "signature" ? "Draw, type, or upload your signature" : "Draw, type, or upload your initials"}</h2>

        {savedAsset && (
          <button
            type="button"
            onClick={() => onCapture(savedAsset)}
            className="flex items-center gap-3 rounded-(--radius-md) border border-primary/40 bg-primary-muted px-3 py-2 text-left transition-colors hover:border-primary/60"
          >
            <img src={savedAsset} alt="" className="h-8 w-20 rounded-(--radius-sm) bg-white object-contain" />
            <span className="text-sm font-medium text-primary">Use my saved {kind}</span>
          </button>
        )}

        <div className="flex gap-1 rounded-(--radius-sm) bg-surface p-1">
          {(["draw", "type", "upload"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-(--radius-sm) py-1.5 text-sm font-medium capitalize transition-colors ${tab === t ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab !== "upload" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-faint">Ink color</span>
            {INK_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={c.label}
                aria-pressed={color.id === c.id}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 transition-transform ${color.id === c.id ? "scale-110 border-text" : "border-transparent hover:scale-105"}`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        )}

        {tab === "draw" && (
          <div className="flex flex-col gap-2">
            <canvas
              ref={canvasRef}
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
              className="cursor-crosshair touch-none self-center rounded-(--radius-sm) border border-border-strong bg-white"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={!hasDrawn} className="self-start">
              Clear
            </Button>
          </div>
        )}

        {tab === "type" && (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              autoFocus
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="Type your name"
              className="h-10 rounded-(--radius-sm) border border-border-strong bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
            />
            <div className="grid grid-cols-2 gap-2">
              {TYPE_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setTypeStyle(style)}
                  aria-label={`${style.label} style`}
                  aria-pressed={typeStyle.id === style.id}
                  className={`flex h-14 items-center justify-center rounded-(--radius-sm) border-2 bg-white px-2 transition-colors ${
                    typeStyle.id === style.id ? "border-primary" : "border-border-strong hover:border-text-faint"
                  }`}
                >
                  <span className="truncate text-2xl" style={{ fontFamily: style.fontFamily, color: color.hex }}>
                    {typedText.trim() || style.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "upload" && (
          <div className="flex flex-col gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            {uploadedDataUrl ? (
              <div
                className="flex items-center justify-center self-center rounded-(--radius-sm) border border-border-strong bg-white"
                style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
              >
                <img src={uploadedDataUrl} alt="Uploaded signature preview" className="max-h-full max-w-full object-contain p-2" />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 self-center rounded-(--radius-sm) border-2 border-dashed border-border-strong bg-surface text-text-muted transition-colors hover:border-primary hover:text-text"
                style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
              >
                <Upload className="h-6 w-6" />
                <span className="text-sm">Choose an image file</span>
              </button>
            )}
            {uploadedDataUrl && (
              <Button variant="ghost" size="sm" onClick={() => setUploadedDataUrl(null)} className="self-start">
                Choose a different file
              </Button>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={saveForReuse} onChange={(e) => setSaveForReuse(e.target.checked)} />
          Save for future use on this device
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!canUse} onClick={() => void handleUse()}>
            Use this {kind === "signature" ? "signature" : "initials"}
          </Button>
        </div>
      </div>
    </div>
  );
}
