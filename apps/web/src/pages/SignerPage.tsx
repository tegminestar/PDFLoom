import { PdfDocument } from "@pdfloom/core";
import { Button, toast } from "@pdfloom/ui";
import { Check, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiUrl } from "../app/supabase";
import { SignatureCaptureModal } from "../features/sign/SignatureCaptureModal";

type FieldType = "signature" | "initials" | "date";

interface SignerField {
  id: string;
  fieldType: FieldType;
  pageNumber: number;
  rect: { x: number; y: number; width: number; height: number };
}

interface OtherSigner {
  name: string | null;
  orderIndex: number;
  status: "pending" | "signed" | "declined";
}

interface SignerView {
  signerName: string | null;
  signerEmail: string;
  status: "pending" | "signed" | "declined" | "not_yet_available";
  requestStatus: "pending" | "completed" | "voided";
  signingMode: "parallel" | "sequential";
  documentUrl: string;
  originalFilename: string;
  fields: SignerField[];
  otherSigners: OtherSigner[];
  completedDocumentUrl: string | null;
}

const TODAY_LABEL = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function HonestyFooter() {
  return (
    <p className="border-t border-border px-6 py-3 text-center text-[11px] text-text-faint">
      This records a visual signature, not a certified, PKI-based digital signature.
    </p>
  );
}

/**
 * The one page in PDFLoom a stranger can open without an account — reached
 * via the unguessable link a document owner shares from "Send for
 * signature." This is the sole place in the product where a document
 * lives on a server rather than only the visitor's own device; see
 * SECURITY.md and the landing page FAQ for that disclosure. Renders the
 * document with PDFLoom's own PdfDocument (the same engine the main app
 * uses) instead of the browser's native PDF viewer, so every field this
 * signer owns can be overlaid at its exact position across any page, not
 * just described in a sidebar.
 */
export function SignerPage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<SignerView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);

  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [initialsDataUrl, setInitialsDataUrl] = useState<string | null>(null);
  // What the active capture modal will do once a signature/initials image is
  // drawn: fill just one field (a deliberate, reviewed placement) or every
  // remaining field of that type (the "all at once" fast path). The backend
  // still stores one shared image per signer per type — it always did — so
  // this doesn't change what gets submitted, only how deliberately the
  // signer places it beforehand.
  const [captureTarget, setCaptureTarget] = useState<{ fieldType: "signature" | "initials"; fieldId: string | null } | null>(null);
  // Other asset types the "sign all at once" action still needs captured
  // before it can mark every remaining field placed.
  const [bulkQueue, setBulkQueue] = useState<("signature" | "initials")[]>([]);
  // Which specific fields the signer has explicitly placed. Clicking one
  // field used to silently stamp every same-type field across the whole
  // document at once, with no chance to review each location first. Now a
  // field only shows the captured image once its own id lands in this set.
  const [placedFieldIds, setPlacedFieldIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [isDeclining, setIsDeclining] = useState(false);

  const loadView = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/sign/${token}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setLoadError(body.error ?? "This signing link isn't valid.");
          return;
        }
        setView(body);
        setLoadError(null);
      })
      .catch(() => setLoadError("Couldn't reach the server. Check your connection and reload."));
  };

  useEffect(() => {
    loadView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Re-check on tab refocus — the closest thing to a "your turn now"
  // notification without adding any new polling/websocket infrastructure.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && view?.status === "not_yet_available") loadView();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.status]);

  useEffect(() => {
    if (!view || view.status === "not_yet_available") return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(view.documentUrl);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const loaded = await PdfDocument.load(bytes);
      if (!cancelled) setDoc(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  const signableFields = view?.fields.filter((f): f is SignerField & { fieldType: "signature" | "initials" } => f.fieldType === "signature" || f.fieldType === "initials") ?? [];
  const unplacedFields = signableFields.filter((f) => !placedFieldIds.has(f.id));
  const canSubmit = signableFields.length > 0 && unplacedFields.length === 0;

  // A single field was clicked: reuse the already-captured image for its
  // type if there is one (no need to redraw the same signature twice), or
  // open the capture modal targeted at just that field.
  const handleFieldClick = (field: SignerField) => {
    if (field.fieldType === "date") return;
    const existing = field.fieldType === "signature" ? signatureDataUrl : initialsDataUrl;
    if (existing) {
      setPlacedFieldIds((prev) => new Set(prev).add(field.id));
      return;
    }
    setCaptureTarget({ fieldType: field.fieldType, fieldId: field.id });
  };

  // "Sign all at once": walk every asset type still needed, skipping
  // straight to marking fields placed for any type already captured, and
  // opening the modal only for the first type that still needs a drawing —
  // the rest queue up behind it.
  const handleSignAllAtOnce = () => {
    const neededTypes = Array.from(new Set(unplacedFields.map((f) => f.fieldType)));
    const stillNeedsCapture = neededTypes.filter((t) => (t === "signature" ? !signatureDataUrl : !initialsDataUrl));
    const alreadyCaptured = neededTypes.filter((t) => (t === "signature" ? !!signatureDataUrl : !!initialsDataUrl));
    if (alreadyCaptured.length > 0) {
      setPlacedFieldIds((prev) => {
        const next = new Set(prev);
        for (const f of unplacedFields) if (alreadyCaptured.includes(f.fieldType)) next.add(f.id);
        return next;
      });
    }
    if (stillNeedsCapture.length === 0) return;
    setCaptureTarget({ fieldType: stillNeedsCapture[0], fieldId: null });
    setBulkQueue(stillNeedsCapture.slice(1));
  };

  const handleCapture = (dataUrl: string) => {
    if (!captureTarget) return;
    const { fieldType, fieldId } = captureTarget;
    if (fieldType === "signature") setSignatureDataUrl(dataUrl);
    else setInitialsDataUrl(dataUrl);
    setPlacedFieldIds((prev) => {
      const next = new Set(prev);
      if (fieldId) {
        next.add(fieldId);
      } else if (view) {
        for (const f of view.fields) if (f.fieldType === fieldType) next.add(f.id);
      }
      return next;
    });
    if (bulkQueue.length > 0) {
      const [nextType, ...rest] = bulkQueue;
      setCaptureTarget({ fieldType: nextType, fieldId: null });
      setBulkQueue(rest);
    } else {
      setCaptureTarget(null);
    }
  };

  const handleSubmit = async () => {
    if (!token || !canSubmit) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signatureDataUrl ?? undefined, initialsDataUrl: initialsDataUrl ?? undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error("Couldn't submit your signature", body.error);
        return;
      }
      setSubmitted(true);
      setView((prev) => (prev ? { ...prev, completedDocumentUrl: body.completedDocumentUrl ?? prev.completedDocumentUrl } : prev));
    } catch {
      toast.error("Couldn't reach the server", "Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!token || !declineReason.trim()) return;
    setIsDeclining(true);
    try {
      const res = await fetch(`${apiUrl}/api/sign/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error("Couldn't decline", body.error);
        return;
      }
      setView((prev) => (prev ? { ...prev, status: "declined" } : prev));
      setDeclineOpen(false);
    } catch {
      toast.error("Couldn't reach the server", "Check your connection and try again.");
    } finally {
      setIsDeclining(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg p-6 text-center">
        <p className="max-w-md text-text-muted">{loadError}</p>
        <HonestyFooter />
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

  if (view.status === "not_yet_available") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <h1 className="font-serif text-2xl font-medium text-text">Not your turn yet</h1>
        <p className="max-w-md text-text-muted">
          {view.originalFilename} is signed in order. You'll be able to sign once everyone before you has finished.
        </p>
        <Button variant="secondary" size="sm" onClick={loadView}>
          Check again
        </Button>
        <HonestyFooter />
      </div>
    );
  }

  if (view.status === "declined") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <h1 className="font-serif text-2xl font-medium text-text">Declined</h1>
        <p className="max-w-md text-text-muted">You declined to sign {view.originalFilename}.</p>
        <HonestyFooter />
      </div>
    );
  }

  if (submitted || view.status === "signed") {
    const pendingOthers = view.otherSigners.filter((s) => s.status === "pending");
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-muted text-primary">
          <Check className="h-6 w-6" />
        </div>
        <h1 className="font-serif text-2xl font-medium text-text">Signed</h1>
        <p className="max-w-md text-text-muted">
          Thanks — your signature on <span className="font-medium text-text">{view.originalFilename}</span> has been recorded.
        </p>
        {view.completedDocumentUrl ? (
          <a
            href={view.completedDocumentUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-(--radius-md) bg-primary px-4 py-2 text-sm font-medium text-primary-text hover:opacity-90"
          >
            <Download className="h-4 w-4" /> Download the signed document
          </a>
        ) : pendingOthers.length > 0 ? (
          <p className="text-sm text-text-faint">Waiting on: {pendingOthers.map((s) => s.name ?? "another signer").join(", ")}</p>
        ) : null}
        <HonestyFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h1 className="font-serif text-lg font-medium text-text">Review &amp; sign</h1>
          <p className="text-sm text-text-muted">
            {view.originalFilename} — signing as {view.signerName ?? view.signerEmail}
          </p>
          {signableFields.length > 0 && (
            <p className="text-xs text-text-faint">
              {signableFields.length - unplacedFields.length} of {signableFields.length} fields placed — click each one to review and sign it
            </p>
          )}
        </div>
        {unplacedFields.length > 1 && (
          <Button variant="secondary" size="sm" onClick={handleSignAllAtOnce}>
            Sign all remaining at once
          </Button>
        )}
      </header>

      <div className="flex flex-1 flex-col items-center gap-6 overflow-y-auto p-6">
        {!doc ? (
          <p className="text-text-muted">Loading document…</p>
        ) : (
          Array.from({ length: Math.max(...view.fields.map((f) => f.pageNumber), 1) }, (_, i) => i + 1).map((pageNumber) => (
            <SignerPageCanvas
              key={pageNumber}
              doc={doc}
              pageNumber={pageNumber}
              fields={view.fields.filter((f) => f.pageNumber === pageNumber)}
              signatureDataUrl={signatureDataUrl}
              initialsDataUrl={initialsDataUrl}
              placedFieldIds={placedFieldIds}
              onFieldClick={handleFieldClick}
            />
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
        <button type="button" onClick={() => setDeclineOpen(true)} className="text-sm text-text-faint underline decoration-dotted hover:text-text">
          Decline to sign
        </button>
        <Button variant="primary" size="sm" disabled={!canSubmit || isSubmitting} onClick={() => void handleSubmit()}>
          {isSubmitting ? "Submitting…" : "Sign document"}
        </Button>
      </div>
      <HonestyFooter />

      {captureTarget && (
        <SignatureCaptureModal
          kind={captureTarget.fieldType}
          onClose={() => {
            setCaptureTarget(null);
            setBulkQueue([]);
          }}
          onCapture={handleCapture}
        />
      )}

      {declineOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-(--color-overlay) p-4">
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-(--radius-lg) border border-border-strong bg-bg-elevated p-5 shadow-(--shadow-floating)">
            <h2 className="text-sm font-semibold text-text">Decline to sign?</h2>
            <p className="text-xs text-text-muted">Let the sender know why — this can't be undone.</p>
            <textarea
              autoFocus
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Reason for declining"
              rows={3}
              className="resize-none rounded-(--radius-sm) border border-border-strong bg-surface px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDeclineOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" disabled={!declineReason.trim() || isDeclining} onClick={() => void handleDecline()}>
                {isDeclining ? "Declining…" : "Decline to sign"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface SignerPageCanvasProps {
  doc: PdfDocument;
  pageNumber: number;
  fields: SignerField[];
  signatureDataUrl: string | null;
  initialsDataUrl: string | null;
  placedFieldIds: Set<string>;
  onFieldClick: (field: SignerField) => void;
}

function SignerPageCanvas({ doc, pageNumber, fields, signatureDataUrl, initialsDataUrl, placedFieldIds, onFieldClick }: SignerPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [screenRects, setScreenRects] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});

  useEffect(() => {
    void (async () => {
      const { widthPt } = await doc.getPageDimensions(pageNumber);
      const targetWidth = Math.min(640, window.innerWidth - 48);
      const scale = targetWidth / widthPt;
      if (canvasRef.current) await doc.renderPage(pageNumber, { scale, canvas: canvasRef.current });
      const entries = await Promise.all(fields.map(async (f) => [f.id, await doc.pdfRectToScreenRect(pageNumber, scale, 0, f.rect)] as const));
      setScreenRects(Object.fromEntries(entries));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber]);

  return (
    <div className="relative shadow-(--shadow-panel)">
      <canvas ref={canvasRef} className="block rounded-(--radius-sm)" />
      {fields.map((field) => {
        const rect = screenRects[field.id];
        if (!rect) return null;
        const style = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
        if (field.fieldType === "date") {
          // Fixed light-mode colors, not theme tokens: this box always sits on
          // a white PDF page regardless of the app's own dark/light theme, so
          // theme-relative text would go near-invisible in dark mode (caught
          // by screenshotting this in dark mode and finding the label
          // unreadable against its own white-ish background).
          return (
            <div key={field.id} style={{ ...style, color: "#141414", borderColor: "#8c8c94" }} className="absolute flex items-center justify-center rounded-[2px] border bg-white/90 text-xs">
              {TODAY_LABEL}
            </div>
          );
        }
        const isPlaced = placedFieldIds.has(field.id);
        const captured = isPlaced ? (field.fieldType === "signature" ? signatureDataUrl : initialsDataUrl) : null;
        return (
          <button
            key={field.id}
            type="button"
            onClick={() => onFieldClick(field)}
            style={style}
            aria-label={captured ? undefined : `Click to ${field.fieldType === "signature" ? "sign" : "initial"} this field`}
            className="absolute flex items-center justify-center overflow-hidden rounded-[2px] border-2 border-dashed border-primary bg-primary-muted text-xs font-medium text-primary hover:bg-primary/20"
          >
            {captured ? <img src={captured} alt="" className="h-full w-full object-contain" /> : field.fieldType === "signature" ? "Click to sign" : "Click to initial"}
          </button>
        );
      })}
    </div>
  );
}
