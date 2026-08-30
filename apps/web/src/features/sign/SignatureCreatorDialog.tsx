import { Button, Dialog, toast } from "@pdfloom/ui";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLoomStore, type SignatureAsset } from "../../app/store";

type CreatorTab = "draw" | "type" | "upload";

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 160;

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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);

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

    if (tab === "draw") {
      if (!hasDrawn || !canvasRef.current) {
        toast.warning("Draw a signature first");
        return;
      }
      const blob = await new Promise<Blob | null>((resolve) => canvasRef.current!.toBlob(resolve, "image/png"));
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      asset = { kind: "image", imageBytes: bytes, imageType: "png", aspectRatio: CANVAS_WIDTH / CANVAS_HEIGHT };
    } else if (tab === "type") {
      if (!typedText.trim()) {
        toast.warning("Type a name first");
        return;
      }
      asset = { kind: "typed", text: typedText.trim() };
    } else {
      if (!uploadedFile) {
        toast.warning("Choose an image first");
        return;
      }
      asset = { kind: "image", imageBytes: uploadedFile.bytes, imageType: uploadedFile.type, aspectRatio: uploadedFile.aspectRatio };
    }

    saveSignatureAsset(slot, asset);
    onOpenChange(false);
    setTypedText("");
    setUploadedFile(null);
    handleClearDraw();
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
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          {(["draw", "type", "upload"] as const).map((t) => (
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

        {tab === "draw" && (
          <div className="flex flex-col gap-2">
            <canvas
              ref={canvasRef}
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
              className="cursor-crosshair touch-none rounded-[--radius-sm] border border-border-strong bg-white"
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
              className="h-10 rounded-[--radius-sm] border border-border-strong bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
            />
            <div
              className="flex items-center justify-center rounded-[--radius-sm] border border-border-strong bg-white px-4"
              style={{ height: CANVAS_HEIGHT, fontFamily: "'Caveat', cursive" }}
            >
              <span className="text-5xl text-[#141414]">{typedText || "Preview"}</span>
            </div>
            <p className="text-xs text-text-faint">Placed as real, crisp text in the document — not a flattened image.</p>
          </div>
        )}

        {tab === "upload" && (
          <div className="flex flex-col gap-2">
            <div className="flex h-[160px] items-center justify-center rounded-[--radius-sm] border border-dashed border-border-strong bg-surface">
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
      </div>
    </Dialog>
  );
}
