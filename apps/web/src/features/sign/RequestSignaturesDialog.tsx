import { Badge, Button, Dialog, IconButton, cn, toast } from "@pdfloom/ui";
import { Check, ChevronLeft, ChevronRight, Copy, FileSignature, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../app/auth";
import { apiUrl, supabase } from "../../app/supabase";
import { useLoomStore } from "../../app/store";
import { AccountDialog } from "../account/AccountDialog";
import { BulkAddSignersInput, type BulkSignerEntry } from "./BulkAddSignersInput";
import { FieldPlacementOverlay, SIGNER_COLORS, type PlacedField, type PlacementFieldType } from "./FieldPlacementOverlay";

interface SignerRow {
  email: string;
  name: string;
}

interface CreatedLink {
  email: string;
  signUrl: string;
}

interface TemplateSummary {
  id: string;
  name: string;
  originalFilename: string;
  signingMode: "parallel" | "sequential";
  roleCount: number;
}

interface TemplateRole {
  id: string;
  roleLabel: string;
  orderIndex: number;
}

type Step = "start" | "signers" | "placement" | "review";
type Mode = "scratch" | "template";

const FIELD_TYPES: { type: PlacementFieldType; label: string }[] = [
  { type: "signature", label: "Signature" },
  { type: "initials", label: "Initials" },
  { type: "date", label: "Date" },
];

/**
 * The one feature that uploads a document to a server — everywhere else in
 * PDFLoom is 100% client-side (see SECURITY.md and the landing page FAQ).
 * A multi-step wizard: pick a starting point (scratch or a saved
 * template) -> add signers (one at a time or pasted in bulk, plus a
 * parallel/sequential order choice) -> place each signer's fields on the
 * actual rendered pages (scratch only — a template already has its
 * layout) -> review and send.
 */
export function RequestSignaturesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);

  const [step, setStep] = useState<Step>("start");
  const [mode, setMode] = useState<Mode>("scratch");
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateRoles, setTemplateRoles] = useState<TemplateRole[] | null>(null);
  const [templateDocumentUrl, setTemplateDocumentUrl] = useState<string | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);

  const [signers, setSigners] = useState<SignerRow[]>([{ email: "", name: "" }]);
  const [signingMode, setSigningMode] = useState<"parallel" | "sequential">("parallel");
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [activeSignerIndex, setActiveSignerIndex] = useState(0);
  const [activeFieldType, setActiveFieldType] = useState<PlacementFieldType | null>("signature");
  const [pageNumber, setPageNumber] = useState(1);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [senderName, setSenderName] = useState("");

  const [isSending, setIsSending] = useState(false);
  const [links, setLinks] = useState<CreatedLink[] | null>(null);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!open || !supabase) return;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) return;
      const res = await fetch(`${apiUrl}/api/signature-templates`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) {
        const body = (await res.json()) as { templates: TemplateSummary[] };
        setTemplates(body.templates);
      }
    })();
  }, [open]);

  const validSigners = signers.filter((s) => s.email.trim());

  const updateSigner = (i: number, patch: Partial<SignerRow>) => setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addSigner = () => setSigners((prev) => [...prev, { email: "", name: "" }]);
  const removeSigner = (i: number) => {
    setSigners((prev) => prev.filter((_, idx) => idx !== i));
    setFields((prev) => prev.filter((f) => f.signerIndex !== i).map((f) => (f.signerIndex > i ? { ...f, signerIndex: f.signerIndex - 1 } : f)));
  };
  const moveSigner = (i: number, direction: -1 | 1) => {
    setSigners((prev) => {
      const next = [...prev];
      const target = i + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[i], next[target]] = [next[target]!, next[i]!];
      return next;
    });
    setFields((prev) =>
      prev.map((f) => {
        if (f.signerIndex === i) return { ...f, signerIndex: i + direction };
        if (f.signerIndex === i + direction) return { ...f, signerIndex: i };
        return f;
      }),
    );
  };
  const handleBulkAdd = (entries: BulkSignerEntry[]) => {
    setSigners((prev) => {
      const existing = new Set(prev.map((s) => s.email.trim().toLowerCase()).filter(Boolean));
      const additions = entries.filter((e) => !existing.has(e.email.toLowerCase())).map((e) => ({ email: e.email, name: e.name }));
      const base = prev.length === 1 && !prev[0]!.email.trim() ? [] : prev;
      return [...base, ...additions];
    });
  };

  const handleSelectTemplate = async (templateId: string) => {
    if (!supabase) return;
    setSelectedTemplateId(templateId);
    setIsLoadingTemplate(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      const res = await fetch(`${apiUrl}/api/signature-templates/${templateId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await res.json();
      if (!res.ok) {
        toast.error("Couldn't load this template", body.error);
        return;
      }
      setTemplateRoles(body.roles.map((r: TemplateRole) => ({ id: r.id, roleLabel: r.roleLabel, orderIndex: r.orderIndex })));
      setTemplateDocumentUrl(body.documentUrl);
      setSigningMode(body.signingMode);
      setSigners(body.roles.map((r: TemplateRole) => ({ email: "", name: r.roleLabel })));
      setMode("template");
      setStep("signers");
    } finally {
      setIsLoadingTemplate(false);
    }
  };

  const startFromScratch = () => {
    setMode("scratch");
    setStep("signers");
  };

  // Render the current placement page to the canvas whenever it changes.
  useEffect(() => {
    if (mode !== "scratch" || step !== "placement" || !doc || !canvasRef.current) return;
    void (async () => {
      const { widthPt } = await doc.getPageDimensions(pageNumber);
      const targetWidth = 560;
      const nextScale = targetWidth / widthPt;
      setScale(nextScale);
      await doc.renderPage(pageNumber, { scale: nextScale, canvas: canvasRef.current! });
    })();
  }, [doc, mode, step, pageNumber]);

  const handlePlaceField = (rect: PlacedField["rect"]) => {
    if (!activeFieldType) return;
    setFields((prev) => [
      ...prev,
      { id: crypto.randomUUID(), signerIndex: activeSignerIndex, fieldType: activeFieldType, pageNumber, rect },
    ]);
  };
  const handleMoveField = (fieldId: string, rect: PlacedField["rect"]) =>
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, rect } : f)));
  const handleRemoveField = (fieldId: string) => setFields((prev) => prev.filter((f) => f.id !== fieldId));

  const signersWithoutFields = mode === "scratch" ? signers.filter((_, i) => !fields.some((f) => f.signerIndex === i)) : [];
  const canReview =
    mode === "scratch"
      ? validSigners.length > 0 && signersWithoutFields.length === 0
      : validSigners.length === signers.length && validSigners.length > 0;

  const handleSend = async () => {
    if (!doc || !meta || !supabase) return;
    setIsSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        // Opens the sign-in dialog right here instead of a dead-end toast —
        // everything already filled in (signers, fields, review) stays
        // exactly as-is underneath, so signing in and clicking Send again
        // is the whole recovery path, not "start over."
        toast.error("Sign in first", "Requesting signatures needs an account, so the request can be tied back to you.");
        setAccountDialogOpen(true);
        return;
      }

      if (mode === "template") {
        const res = await fetch(`${apiUrl}/api/signature-requests`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: selectedTemplateId,
            signingMode,
            senderName: senderName.trim() || undefined,
            roleAssignments: (templateRoles ?? []).map((r, i) => ({ roleId: r.id, email: signers[i]!.email.trim(), name: signers[i]!.name.trim() || undefined })),
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          toast.error("Couldn't send for signature", body.error);
          return;
        }
        setLinks(body.signers);
        toast.success("Request created", "Copy each link below and send it to that signer.");
        return;
      }

      const rawBytes = await doc.getRawBytes();
      const fileBase64 = btoa(Array.from(rawBytes, (b) => String.fromCharCode(b)).join(""));

      if (saveAsTemplate && templateName.trim()) {
        const templateRes = await fetch(`${apiUrl}/api/signature-templates`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: templateName.trim(),
            filename: meta.name,
            fileBase64,
            signingMode,
            roles: signers.map((s, i) => ({
              roleLabel: s.name.trim() || `Signer ${i + 1}`,
              orderIndex: i,
              fields: fields.filter((f) => f.signerIndex === i).map((f) => ({ fieldType: f.fieldType, pageNumber: f.pageNumber, rect: f.rect })),
            })),
          }),
        });
        if (!templateRes.ok) {
          const body = await templateRes.json().catch(() => ({}));
          toast.warning("Couldn't save as a template", body.error ?? "The request will still be sent.");
        }
      }

      const res = await fetch(`${apiUrl}/api/signature-requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: meta.name,
          fileBase64,
          signingMode,
          senderName: senderName.trim() || undefined,
          signers: validSigners.map((s) => {
            const i = signers.indexOf(s);
            return {
              email: s.email.trim(),
              name: s.name.trim() || undefined,
              orderIndex: i,
              fields: fields.filter((f) => f.signerIndex === i).map((f) => ({ fieldType: f.fieldType, pageNumber: f.pageNumber, rect: f.rect })),
            };
          }),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error("Couldn't send for signature", body.error);
        return;
      }
      setLinks(body.signers);
      toast.success("Request created", "Copy each link below and send it to that signer.");
    } catch (error) {
      toast.error("Couldn't send for signature", error instanceof Error ? error.message : undefined);
    } finally {
      setIsSending(false);
    }
  };

  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const handleCopy = async (link: CreatedLink) => {
    await navigator.clipboard.writeText(link.signUrl);
    setCopiedEmail(link.email);
    setTimeout(() => setCopiedEmail(null), 1500);
  };

  const reset = () => {
    setStep("start");
    setMode("scratch");
    setSelectedTemplateId(null);
    setTemplateRoles(null);
    setTemplateDocumentUrl(null);
    setSigners([{ email: "", name: "" }]);
    setSigningMode("parallel");
    setFields([]);
    setActiveSignerIndex(0);
    setActiveFieldType("signature");
    setPageNumber(1);
    setSaveAsTemplate(false);
    setTemplateName("");
    setSenderName("");
    setLinks(null);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const stepTitle: Record<Step, string> = {
    start: "Send for signature",
    signers: mode === "template" ? "Who's signing?" : "Add signers",
    placement: "Place signature fields",
    review: "Review & send",
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={handleClose}
        title={links ? "Request sent" : stepTitle[step]}
      description={
        links
          ? "Uploads this document so the people you list can sign it — the one exception to PDFLoom staying fully on-device."
          : undefined
      }
      width={step === "placement" ? 960 : 560}
      footer={
        links ? (
          <Button variant="primary" size="sm" onClick={() => handleClose(false)}>
            Done
          </Button>
        ) : (
          <>
            {step !== "start" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setStep(step === "review" ? (mode === "scratch" ? "placement" : "signers") : step === "placement" ? "signers" : "start")}
                disabled={isSending}
              >
                Back
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => handleClose(false)} disabled={isSending}>
              Cancel
            </Button>
            {step === "signers" && (
              <Button variant="primary" size="sm" disabled={validSigners.length === 0} onClick={() => setStep(mode === "template" ? "review" : "placement")}>
                Next
              </Button>
            )}
            {step === "placement" && (
              <Button variant="primary" size="sm" disabled={!canReview} onClick={() => setStep("review")}>
                Review
              </Button>
            )}
            {step === "review" && (
              <Button variant="primary" size="sm" disabled={isSending || !canReview} onClick={() => void handleSend()}>
                {isSending ? "Sending…" : "Send for signature"}
              </Button>
            )}
          </>
        )
      }
    >
      {links ? (
        <div className="flex flex-col gap-2">
          {links.map((link) => (
            <div key={link.email} className="flex items-center justify-between gap-2 rounded-(--radius-sm) border border-border-strong bg-surface p-2.5">
              <span className="truncate text-sm text-text">{link.email}</span>
              <button
                type="button"
                onClick={() => void handleCopy(link)}
                className="flex shrink-0 items-center gap-1 rounded-(--radius-sm) px-2 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
              >
                {copiedEmail === link.email ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedEmail === link.email ? "Copied" : "Copy link"}
              </button>
            </div>
          ))}
        </div>
      ) : step === "start" ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={startFromScratch}
            className="flex items-center gap-3 rounded-(--radius-md) border border-border bg-bg-elevated p-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-hover"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-sm) bg-primary-muted text-primary">
              <FileSignature className="h-[18px] w-[18px]" />
            </div>
            <div>
              <div className="text-sm font-medium text-text">Start from scratch</div>
              <div className="text-xs text-text-faint">Add signers and place fields on this document.</div>
            </div>
          </button>

          {templates && templates.length > 0 && (
            <>
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-text-faint">Or start from a template</p>
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={isLoadingTemplate}
                  onClick={() => void handleSelectTemplate(t.id)}
                  className="flex items-center gap-3 rounded-(--radius-md) border border-border bg-bg-elevated p-3 text-left transition-colors hover:border-primary/50 hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-sm) bg-ai-muted text-ai">
                    <Sparkles className="h-[18px] w-[18px]" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-text">{t.name}</div>
                    <div className="text-xs text-text-faint">
                      {t.roleCount} {t.roleCount === 1 ? "role" : "roles"} · {t.signingMode === "sequential" ? "Sequential" : "Parallel"} signing
                    </div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      ) : step === "signers" ? (
        <div className="flex flex-col gap-3">
          {mode === "template" && templateDocumentUrl && (
            <p className="text-xs text-text-faint">Enter a real email for each role in this template.</p>
          )}
          {signers.map((signer, i) => (
            <div key={i} className="flex items-center gap-2">
              {signingMode === "sequential" && mode === "scratch" && (
                <div className="flex shrink-0 flex-col">
                  <IconButton icon={<ChevronLeft className="-rotate-90" />} label="Move earlier" size="sm" disabled={i === 0} onClick={() => moveSigner(i, -1)} />
                  <IconButton icon={<ChevronRight className="-rotate-90" />} label="Move later" size="sm" disabled={i === signers.length - 1} onClick={() => moveSigner(i, 1)} />
                </div>
              )}
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }}
                aria-hidden
              />
              <input
                type="email"
                value={signer.email}
                onChange={(e) => updateSigner(i, { email: e.target.value })}
                placeholder="signer@example.com"
                className="h-9 flex-1 rounded-(--radius-sm) border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
              />
              <input
                type="text"
                value={signer.name}
                onChange={(e) => updateSigner(i, { name: e.target.value })}
                placeholder={mode === "template" ? "Role" : "Name (optional)"}
                readOnly={mode === "template"}
                className="h-9 w-36 rounded-(--radius-sm) border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring) read-only:text-text-faint"
              />
              {mode === "scratch" && signers.length > 1 && (
                <button type="button" onClick={() => removeSigner(i)} className="text-text-faint hover:text-text">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {mode === "scratch" && (
            <>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={addSigner} className="self-start">
                  <Plus className="h-3.5 w-3.5" /> Add another signer
                </Button>
                <BulkAddSignersInput onAdd={handleBulkAdd} />
              </div>

              <div className="mt-1 flex items-center gap-2 rounded-(--radius-sm) bg-surface p-1">
                {(["parallel", "sequential"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSigningMode(m)}
                    className={cn(
                      "flex-1 rounded-(--radius-sm) py-1.5 text-sm font-medium capitalize transition-colors",
                      signingMode === m ? "bg-primary text-primary-text" : "text-text-muted hover:text-text",
                    )}
                  >
                    {m === "parallel" ? "Any order" : "In order"}
                  </button>
                ))}
              </div>
              <p className="px-1 text-xs text-text-faint">
                {signingMode === "sequential"
                  ? "Each signer is notified it's their turn only after the person before them finishes."
                  : "Every signer can sign as soon as they get their link."}
              </p>
            </>
          )}
        </div>
      ) : step === "placement" && doc ? (
        <div className="flex gap-4">
          <div className="flex w-40 shrink-0 flex-col gap-3">
            <div>
              <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-text-faint">Placing for</p>
              <div className="flex flex-col gap-1">
                {signers.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveSignerIndex(i)}
                    className={cn(
                      "flex items-center gap-2 truncate rounded-(--radius-sm) px-2 py-1.5 text-left text-xs",
                      activeSignerIndex === i ? "bg-primary-muted text-primary" : "text-text-muted hover:bg-surface-hover hover:text-text",
                    )}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }} aria-hidden />
                    <span className="truncate">{s.name.trim() || s.email || `Signer ${i + 1}`}</span>
                    {signersWithoutFields.includes(s) && <span className="ml-auto text-text-faint" title="No fields placed yet">•</span>}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-text-faint">Field type</p>
              <div className="flex flex-col gap-1">
                {FIELD_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setActiveFieldType(activeFieldType === type ? null : type)}
                    className={cn(
                      "rounded-(--radius-sm) px-2 py-1.5 text-left text-xs",
                      activeFieldType === type ? "bg-primary-muted text-primary" : "text-text-muted hover:bg-surface-hover hover:text-text",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 px-1 text-[11px] leading-snug text-text-faint">
                Click the page to place a field. Drag to move, or drag the corner handle to resize.
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-center gap-2">
              <IconButton icon={<ChevronLeft />} label="Previous page" size="sm" disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => p - 1)} />
              <span className="text-xs text-text-muted">
                Page {pageNumber} / {meta?.pageCount ?? 1}
              </span>
              <IconButton icon={<ChevronRight />} label="Next page" size="sm" disabled={pageNumber >= (meta?.pageCount ?? 1)} onClick={() => setPageNumber((p) => p + 1)} />
            </div>
            <div className="relative mx-auto max-h-[65vh] overflow-auto rounded-(--radius-sm) border border-border bg-bg">
              <div className="relative inline-block">
                <canvas ref={canvasRef} className="block" />
                <FieldPlacementOverlay
                  doc={doc}
                  pageNumber={pageNumber}
                  scale={scale}
                  fields={fields}
                  activeSignerIndex={activeSignerIndex}
                  activeFieldType={activeFieldType}
                  onPlace={handlePlaceField}
                  onMove={handleMoveField}
                  onRemove={handleRemoveField}
                />
              </div>
            </div>
          </div>
        </div>
      ) : step === "review" ? (
        <div className="flex flex-col gap-3">
          {!authLoading &&
            (authUser ? (
              <div className="flex items-center gap-2 text-xs text-text-faint">
                <Badge tone="success">Signed in</Badge>
                Sending as {authUser.email}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-(--radius-md) border border-warning/40 bg-warning-muted px-3 py-2">
                <span className="text-xs text-warning">You'll need to sign in before this can be sent.</span>
                <Button variant="secondary" size="sm" onClick={() => setAccountDialogOpen(true)}>
                  Sign in
                </Button>
              </div>
            ))}
          <div className="flex flex-col gap-1">
            <label className="px-1 text-xs font-medium text-text-muted" htmlFor="sender-name-input">
              Your name (shown to signers)
            </label>
            <input
              id="sender-name-input"
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="e.g. Jane Doe"
              className="h-9 rounded-(--radius-sm) border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
            />
          </div>
          <div className="flex flex-col gap-2">
            {signers.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-(--radius-sm) border border-border-strong bg-surface p-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }} aria-hidden />
                  <span className="truncate text-text">{s.name.trim() || s.email}</span>
                  {s.name.trim() && <span className="shrink-0 truncate text-xs text-text-faint">{s.email}</span>}
                </div>
                {mode === "scratch" && <span className="shrink-0 text-xs text-text-faint">{fields.filter((f) => f.signerIndex === i).length} field(s)</span>}
              </div>
            ))}
          </div>
          <p className="text-xs text-text-faint">
            Signing order: {signingMode === "sequential" ? "in the order listed above" : "any order"}. Each signer gets
            an emailed link automatically — you'll also see every link here to copy and share yourself if you'd
            rather.
          </p>
          {mode === "scratch" && (
            <div className="flex flex-col gap-2 rounded-(--radius-sm) border border-border-strong bg-surface p-2.5">
              <label className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} />
                Save this layout as a reusable template
              </label>
              {saveAsTemplate && (
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name, e.g. Standard residential lease"
                  className="h-9 rounded-(--radius-sm) border border-border-strong bg-bg px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
                />
              )}
            </div>
          )}
        </div>
      ) : null}
      </Dialog>
      <AccountDialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen} />
    </>
  );
}
