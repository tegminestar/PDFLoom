import { Button, toast } from "@pdfloom/ui";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useParams } from "react-router-dom";
import { apiUrl } from "../app/supabase";

interface SignerView {
  signerName: string | null;
  signerEmail: string;
  status: "pending" | "signed" | "declined";
  pageNumber: number;
  documentUrl: string;
  originalFilename: string;
  requestStatus: "pending" | "completed" | "voided";
}

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 160;

/**
 * The one page in PDFLoom a stranger can open without an account — reached
 * via the unguessable link a document owner shares from "Request
 * signatures." This is the sole place in the product where a document
 * lives on a server rather than only the visitor's own device; see
 * SECURITY.md and the landing page FAQ for that disclosure. The document
 * itself is shown via the browser's native PDF viewer (an <iframe>) rather
 * than PDFLoom's own renderer — this page has no relation to the app
 * shell/store, it's a standalone flow for someone who may never use the
 * rest of the product.
 */
export function SignerPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<SignerView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typedText, setTypedText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/sign/${token}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(body.error ?? "This signing link isn't valid.");
          return;
        }
        setView(body);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't reach the server. Check your connection and reload.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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

  const handleSubmit = async () => {
    if (!token) return;
    let dataUrl: string | null = null;

    if (tab === "draw") {
      if (!hasDrawn || !canvasRef.current) {
        toast.warning("Draw your signature first");
        return;
      }
      dataUrl = canvasRef.current.toDataURL("image/png");
    } else {
      if (!typedText.trim()) {
        toast.warning("Type your name first");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_WIDTH * 2;
      canvas.height = CANVAS_HEIGHT * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.font = "48px cursive";
      ctx.fillStyle = "#141414";
      ctx.textBaseline = "middle";
      ctx.fillText(typedText.trim(), 12, CANVAS_HEIGHT / 2);
      dataUrl = canvas.toDataURL("image/png");
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: dataUrl }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error("Couldn't submit your signature", body.error);
        return;
      }
      setSubmitted(true);
    } catch {
      toast.error("Couldn't reach the server", "Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-6 text-center">
        <p className="max-w-md text-text-muted">{loadError}</p>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <p className="text-text-muted">Loading document…</p>
      </div>
    );
  }
  if (submitted || view.status === "signed") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-muted text-primary">
          <Check className="h-6 w-6" />
        </div>
        <h1 className="font-serif text-2xl font-medium text-text">Signed</h1>
        <p className="max-w-md text-text-muted">
          Thanks — your signature on <span className="font-medium text-text">{view.originalFilename}</span> has been recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-border px-6 py-4">
        <h1 className="font-serif text-lg font-medium text-text">Review &amp; sign</h1>
        <p className="text-sm text-text-muted">
          {view.originalFilename} — signing as {view.signerName ?? view.signerEmail}
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6 lg:flex-row">
        <iframe title="Document to sign" src={view.documentUrl} className="min-h-[50vh] flex-1 rounded-[--radius-md] border border-border bg-white" />
        <div className="flex w-full flex-col gap-3 lg:w-[520px]">
          <p className="text-xs text-text-faint">
            Your signature will be placed on page {view.pageNumber} of the document, at the spot the sender specified.
          </p>
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
          <Button variant="primary" size="sm" disabled={isSubmitting} onClick={() => void handleSubmit()}>
            {isSubmitting ? "Submitting…" : "Sign document"}
          </Button>
        </div>
      </div>
    </div>
  );
}
