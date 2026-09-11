import type { SignatureFontId } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLoomStore, type SignatureAsset } from "../../app/store";
import { getSavedSignatureDataUrl, setSavedSignatureDataUrl } from "./signatureStorage";

type CreatorTab = "draw" | "type" | "upload";

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 160;

const INK_COLORS = [
  { id: "black", label: "Black", hex: "#141414" },
  { id: "blue", label: "Blue", hex: "#1a56db" },
  { id: "navy", label: "Navy", hex: "#1e3a5f" },
  { id: "red", label: "Red", hex: "#c92a2a" },
] as const;

// ids match SignatureFontId in packages/core/src/pdf/signature.ts exactly —
// this is what actually gets embedded, not just a CSS preview choice.
const TYPE_STYLES: { id: SignatureFontId; label: string; fontFamily: string }[] = [
  { id: "caveat", label: "Caveat", fontFamily: "'Caveat', cursive" },
  { id: "dancing-script", label: "Dancing Script", fontFamily: "'Dancing Script', cursive" },
  { id: "sacramento", label: "Sacramento", fontFamily: "'Sacramento', cursive" },
  { id: "pacifico", label: "Pacifico", fontFamily: "'Pacifico', cursive" },
];

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// A rasterized snapshot for the "use my saved signature" quick-reuse
// thumbnail only — the real typed-signature placement stays real vector
// text via SignatureAsset's "typed" kind, never this. Same font/color the
// signer actually chose, so the thumbnail matches what gets placed.
function renderTypedPreview(text: string, fontFamily: string, colorHex: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH * 2;
  canvas.height = CANVAS_HEIGHT * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.font = `48px ${fontFamily}`;
  ctx.fillStyle = colorHex;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, CANVAS_HEIGHT / 2);
  return canvas.toDataURL("image/png");
}

function dataUrlFromBytes(bytes: Uint8Array, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: mimeType }));
  });
}

export interface SignatureCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which slot this creates — signature (full mark) or initials (smaller, reuses the exact same mechanism). */
  slot: "signature" | "initials";
}

/**
 * Creates a signature or initials asset via draw (freehand canvas),
 * type (real vector text in a cursive font, embedded by
 * packages/core/src/pdf/signature.ts — not rasterized), or upload (an
 * existing image). Saving arms click-to-place mode; the actual stamping
 * onto a page happens in SignaturePlaceOverlay.
 */
export function SignatureCreatorDialog({ open, onOpenChange, slot }: SignatureCreatorDialogProps) {
  const saveSignatureAsset = useLoomStore((s) => s.saveSignatureAsset);

  const [tab, setTab] = useState<CreatorTab>("draw");
  const [typedText, setTypedText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{ bytes: Uint8Array; type: "png" | "jpg"; aspectRatio: number } | null>(null);
  const [color, setColor] = useState<(typeof INK_COLORS)[number]>(INK_COLORS[0]);
  const [typeStyle, setTypeStyle] = useState<(typeof TYPE_STYLES)[number]>(TYPE_STYLES[0]);
  const [saveForReuse, setSaveForReuse] = useState(true);
  const [savedAsset, setSavedAssetState] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setSavedAssetState(getSavedSignatureDataUrl(slot));
  }, [slot]);

  useEffect(() => {
    if (!uploadedFile) {
      setUploadedPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([uploadedFile.bytes as BlobPart]));
    setUploadedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadedFile]);

  const ensureCanvasInit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (canvas.width !== CANVAS_WIDTH * 2) {
      // Render at 2x for a crisp captured signature regardless of display size.
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
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDrawingRef.current = true;
    lastPointRef.current = point;
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

  const handleClearDraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleUploadFile = async (file: File) => {
    const type = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : null;
    if (!type) {
      toast.error("Unsupported image type", "Choose a PNG or JPEG file.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
    setUploadedFile({ bytes, type, aspectRatio: dims.width / dims.height });
  };

  const handleSave = async () => {
    let asset: SignatureAsset | null = null;
    // Only for the "use my saved signature" quick-reuse thumbnail elsewhere
    // (SignerPage's SignatureCaptureModal, or reopening this dialog) — the
    // real placement mechanism for each kind is untouched (typed stays real
    // vector text, never rasterized, when actually placed onto a page).
    let reuseDataUrl: string | null = null;

    if (tab === "draw") {
      if (!hasDrawn || !canvasRef.current) {
        toast.warning("Draw a signature first");
        return;
      }
      const blob = await new Promise<Blob | null>((resolve) => canvasRef.current!.toBlob(resolve, "image/png"));
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      asset = { kind: "image", imageBytes: bytes, imageType: "png", aspectRatio: CANVAS_WIDTH / CANVAS_HEIGHT };
      reuseDataUrl = canvasRef.current.toDataURL("image/png");
    } else if (tab === "type") {
      if (!typedText.trim()) {
        toast.warning("Type a name first");
        return;
      }
      asset = { kind: "typed", text: typedText.trim(), color: hexToRgb01(color.hex), fontId: typeStyle.id };
      if (saveForReuse) reuseDataUrl = renderTypedPreview(typedText.trim(), typeStyle.fontFamily, color.hex);
    } else {
      if (!uploadedFile) {
        toast.warning("Choose an image first");
        return;
      }
      asset = { kind: "image", imageBytes: uploadedFile.bytes, imageType: uploadedFile.type, aspectRatio: uploadedFile.aspectRatio };
      if (saveForReuse) reuseDataUrl = await dataUrlFromBytes(uploadedFile.bytes, uploadedFile.type === "png" ? "image/png" : "image/jpeg");
    }

    if (saveForReuse && reuseDataUrl) setSavedSignatureDataUrl(slot, reuseDataUrl);
    saveSignatureAsset(slot, asset);
    onOpenChange(false);
    setTypedText("");
    setUploadedFile(null);
    handleClearDraw();
  };

  const handleUseSaved = () => {
    if (!savedAsset) return;
    const bytes = Uint8Array.from(atob(savedAsset.split(",")[1]!), (c) => c.charCodeAt(0));
    saveSignatureAsset(slot, { kind: "image", imageBytes: bytes, imageType: "png", aspectRatio: CANVAS_WIDTH / CANVAS_HEIGHT });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={slot === "signature" ? "Create signature" : "Create initials"}
      description="Stays entirely on your device — nothing is uploaded."
      width={540}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void handleSave()}>
            Use this {slot === "signature" ? "signature" : "initials"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {savedAsset && (
          <button
            type="button"
            onClick={handleUseSaved}
            className="flex items-center gap-3 rounded-(--radius-md) border border-primary/40 bg-primary-muted px-3 py-2 text-left transition-colors hover:border-primary/60"
          >
            <img src={savedAsset} alt="" className="h-8 w-20 rounded-(--radius-sm) bg-white object-contain" />
            <span className="text-sm font-medium text-primary">Use my saved {slot}</span>
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
              className="cursor-crosshair touch-none rounded-(--radius-sm) border border-border-strong bg-white"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
            <Button variant="ghost" size="sm" onClick={handleClearDraw} disabled={!hasDrawn} className="self-start">
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
            <div
              className="flex items-center justify-center rounded-(--radius-sm) border border-border-strong bg-white px-4"
              style={{ height: CANVAS_HEIGHT, fontFamily: typeStyle.fontFamily }}
            >
              <span className="text-5xl" style={{ color: color.hex }}>
                {typedText || "Preview"}
              </span>
            </div>
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
            <p className="text-xs text-text-faint">Placed as real, crisp text in the document — not a flattened image.</p>
          </div>
        )}

        {tab === "upload" && (
          <div className="flex flex-col gap-2">
            <div className="flex h-[160px] items-center justify-center rounded-(--radius-sm) border border-dashed border-border-strong bg-surface">
              {uploadedPreviewUrl ? (
                <img src={uploadedPreviewUrl} alt="Uploaded signature preview" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-sm text-text-faint">No image chosen</span>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="self-start">
              Choose image…
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleUploadFile(file);
              }}
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={saveForReuse} onChange={(e) => setSaveForReuse(e.target.checked)} />
          Save for future use on this device
        </label>
      </div>
    </Dialog>
  );
}
