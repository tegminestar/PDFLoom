import { Button, Dialog, toast } from "@pdfloom/ui";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { apiUrl, supabase } from "../../app/supabase";
import { useLoomStore } from "../../app/store";

interface SignerRow {
  email: string;
  name: string;
}

interface CreatedLink {
  email: string;
  signUrl: string;
}

/**
 * The one feature that uploads a document to a server — everywhere else in
 * PDFLoom is 100% client-side (see SECURITY.md and the landing page FAQ).
 * v1 scope: each signer's signature is placed at a fixed spot stacked
 * along the bottom of the document's last page (no per-signer field
 * placement UI yet), and invite links are generated for the owner to copy
 * and send themselves — no automated email (no send-mail credential is
 * provisioned for the backend yet).
 */
export function RequestSignaturesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);

  const [signers, setSigners] = useState<SignerRow[]>([{ email: "", name: "" }]);
  const [isSending, setIsSending] = useState(false);
  const [links, setLinks] = useState<CreatedLink[] | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const updateSigner = (i: number, patch: Partial<SignerRow>) => setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addSigner = () => setSigners((prev) => [...prev, { email: "", name: "" }]);
  const removeSigner = (i: number) => setSigners((prev) => prev.filter((_, idx) => idx !== i));

  const handleSend = async () => {
    if (!doc || !meta || !supabase) return;
    const validSigners = signers.filter((s) => s.email.trim());
    if (validSigners.length === 0) {
      toast.warning("Add at least one signer's email");
      return;
    }
    setIsSending(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error("Sign in first", "Requesting signatures needs an account, so the request can be tied back to you.");
        return;
      }

      const lastPage = meta.pageCount;
      const { widthPt } = await doc.getPageDimensions(lastPage);
      // Stack each signer's box along the bottom of the last page, left to
      // right — a fixed v1 default; a real per-signer placement UI (like
      // SignaturePlaceOverlay, but for someone else's future signature) is
      // future work.
      const boxWidth = 160;
      const boxHeight = 50;
      const margin = 24;
      const gap = 16;
      const totalWidth = validSigners.length * boxWidth + (validSigners.length - 1) * gap;
      const startX = Math.max(margin, (widthPt - totalWidth) / 2);

      const rawBytes = await doc.getRawBytes();
      const fileBase64 = btoa(Array.from(rawBytes, (b) => String.fromCharCode(b)).join(""));

      const res = await fetch(`${apiUrl}/api/signature-requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: meta.name,
          fileBase64,
          signers: validSigners.map((s, i) => ({
            email: s.email.trim(),
            name: s.name.trim() || undefined,
            pageNumber: lastPage,
            rect: { x: startX + i * (boxWidth + gap), y: margin, width: boxWidth, height: boxHeight },
          })),
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

  const handleCopy = async (link: CreatedLink) => {
    await navigator.clipboard.writeText(link.signUrl);
    setCopiedEmail(link.email);
    setTimeout(() => setCopiedEmail(null), 1500);
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSigners([{ email: "", name: "" }]);
      setLinks(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title="Request signatures"
      description="Uploads this document so the people you list can sign it — the one exception to PDFLoom staying fully on-device. Everything else in the app never leaves your browser."
      width={480}
      footer={
        links ? (
          <Button variant="primary" size="sm" onClick={() => handleClose(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => handleClose(false)} disabled={isSending}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={isSending} onClick={() => void handleSend()}>
              {isSending ? "Sending…" : "Send for signature"}
            </Button>
          </>
        )
      }
    >
      {links ? (
        <div className="flex flex-col gap-2">
          {links.map((link) => (
            <div key={link.email} className="flex items-center justify-between gap-2 rounded-[--radius-sm] border border-border-strong bg-surface p-2.5">
              <span className="truncate text-sm text-text">{link.email}</span>
              <button
                type="button"
                onClick={() => void handleCopy(link)}
                className="flex shrink-0 items-center gap-1 rounded-[--radius-sm] px-2 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
              >
                {copiedEmail === link.email ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedEmail === link.email ? "Copied" : "Copy link"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {signers.map((signer, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="email"
                value={signer.email}
                onChange={(e) => updateSigner(i, { email: e.target.value })}
                placeholder="signer@example.com"
                className="h-9 flex-1 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
              />
              <input
                type="text"
                value={signer.name}
                onChange={(e) => updateSigner(i, { name: e.target.value })}
                placeholder="Name (optional)"
                className="h-9 w-36 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
              />
              {signers.length > 1 && (
                <button type="button" onClick={() => removeSigner(i)} className="text-text-faint hover:text-text">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={addSigner} className="self-start">
            <Plus className="h-3.5 w-3.5" /> Add another signer
          </Button>
          <p className="text-xs text-text-faint">Each signer's box is placed along the bottom of the last page. No email is sent automatically — you'll get a link to share yourself.</p>
        </div>
      )}
    </Dialog>
  );
}
