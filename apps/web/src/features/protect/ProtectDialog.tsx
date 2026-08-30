import { getPdfWorkerClient, type PdfPermissions, type SanitizeOptions, type SanitizeReport } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

type Tab = "add" | "remove" | "sanitize";

const PERMISSION_TOGGLES: { key: keyof PdfPermissions; label: string }[] = [
  { key: "printing", label: "Printing" },
  { key: "copying", label: "Copying text/images" },
  { key: "modifying", label: "Editing content" },
  { key: "annotating", label: "Annotations & comments" },
  { key: "fillingForms", label: "Filling forms" },
  { key: "documentAssembly", label: "Inserting/deleting pages" },
];

const SANITIZE_TOGGLES: { key: keyof SanitizeOptions; label: string; hint: string }[] = [
  { key: "clearInfoMetadata", label: "Document info", hint: "Title, author, subject, keywords, creator" },
  { key: "removeXmpMetadata", label: "XMP metadata", hint: "A separate metadata copy some tools leave behind" },
  { key: "removeEmbeddedFiles", label: "Embedded files", hint: "Any attachments hidden inside the document" },
  { key: "removeJavaScript", label: "Embedded scripts", hint: "Document-level JavaScript, including any auto-run-on-open action" },
];

/**
 * Password protection, built on a from-scratch implementation of the PDF
 * Standard Security Handler (AES-128/R4) — pdf-lib has no encryption
 * support at all, and every third-party option for it is either
 * unmaintained or a brand-new, unvetted single-maintainer package, an
 * unacceptable risk for security-sensitive code. See
 * packages/core/src/pdf/crypto/standard-security-handler.ts for the full
 * rationale and packages/core's own test suite for verification against
 * pdf.js's independent decryption.
 *
 * "Add password" downloads a *new* protected file rather than replacing
 * the open document — pdf-lib (and everything built on it: organize,
 * annotate, forms, etc.) cannot read encrypted bytes at all, so keeping
 * the in-app copy protected would silently break every other tool. The
 * open document stays the normal, editable working copy; protection is
 * something you export, matching how a "Print" or "Export" action works
 * elsewhere in the app.
 */
export function ProtectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const storage = useLoomStore((s) => s.storage);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [tab, setTab] = useState<Tab>("add");

  const [userPassword, setUserPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [permissions, setPermissions] = useState<PdfPermissions>({});
  const [isProtecting, setIsProtecting] = useState(false);

  const [removePassword, setRemovePassword] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [sanitizeOptions, setSanitizeOptions] = useState<SanitizeOptions>({
    clearInfoMetadata: true,
    removeXmpMetadata: true,
    removeEmbeddedFiles: true,
    removeJavaScript: true,
  });
  const [isSanitizing, setIsSanitizing] = useState(false);
  const [sanitizeReport, setSanitizeReport] = useState<SanitizeReport | null>(null);

  const togglePermission = (key: keyof PdfPermissions) => setPermissions((prev) => ({ ...prev, [key]: prev[key] === false ? undefined : false }));

  const handleAddPassword = async () => {
    if (!doc || !meta) return;
    if (!userPassword && !ownerPassword) {
      toast.warning("Set at least one password", "An owner password (or a user password, which also becomes the owner password) is required.");
      return;
    }
    setIsProtecting(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await client.encryptDocument(await doc.getRawBytes(), {
        userPassword: userPassword || undefined,
        ownerPassword: ownerPassword || undefined,
        permissions,
      });
      const baseName = meta.name.replace(/\.pdf$/i, "");
      await storage.save(new Uint8Array(bytes), `${baseName}-protected.pdf`);
      toast.success("Protected copy saved", "The open document itself is unchanged and still fully editable.");
      onOpenChange(false);
      setUserPassword("");
      setOwnerPassword("");
      setPermissions({});
    } catch (error) {
      toast.error("Couldn't protect this document", error instanceof Error ? error.message : undefined);
    } finally {
      setIsProtecting(false);
    }
  };

  const handleRemoveProtection = async () => {
    if (!doc) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      const client = await getPdfWorkerClient();
      const result = await client.decryptDocument(await doc.getRawBytes(), removePassword);
      await applyPdfMutation(new Uint8Array(result.bytes));
      toast.success("Protection removed", "The document is now unlocked and fully editable.");
      onOpenChange(false);
      setRemovePassword("");
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Couldn't remove protection.");
    } finally {
      setIsRemoving(false);
    }
  };

  const handleSanitize = async () => {
    if (!doc) return;
    setIsSanitizing(true);
    setSanitizeReport(null);
    try {
      const client = await getPdfWorkerClient();
      const { bytes, report } = await client.sanitizeDocument(await doc.getRawBytes(), sanitizeOptions);
      await applyPdfMutation(new Uint8Array(bytes));
      setSanitizeReport(report);
      const nothingFound = !report.clearedInfoMetadata && !report.removedXmpMetadata && report.removedEmbeddedFileCount === 0 && !report.removedJavaScript;
      toast[nothingFound ? "info" : "success"](nothingFound ? "Nothing to remove" : "Document cleaned", nothingFound ? "No hidden data matched what you selected." : undefined);
    } catch (error) {
      toast.error("Couldn't clean this document", error instanceof Error ? error.message : undefined);
    } finally {
      setIsSanitizing(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Protect"
      description="Password protection uses real AES-128 encryption, applied entirely on your device."
      width={440}
      footer={
        tab === "add" ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isProtecting}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={isProtecting} onClick={() => void handleAddPassword()}>
              {isProtecting ? "Protecting…" : "Save protected copy"}
            </Button>
          </>
        ) : tab === "remove" ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isRemoving}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!removePassword || isRemoving} onClick={() => void handleRemoveProtection()}>
              {isRemoving ? "Unlocking…" : "Remove protection"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isSanitizing}>
              {sanitizeReport ? "Close" : "Cancel"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={isSanitizing || !Object.values(sanitizeOptions).some(Boolean)}
              onClick={() => void handleSanitize()}
            >
              {isSanitizing ? "Cleaning…" : "Clean document"}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
          <button
            type="button"
            onClick={() => setTab("add")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${tab === "add" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Add password
          </button>
          <button
            type="button"
            onClick={() => setTab("remove")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${tab === "remove" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Remove protection
          </button>
          <button
            type="button"
            onClick={() => setTab("sanitize")}
            className={`flex-1 rounded-[--radius-sm] py-1.5 text-sm font-medium transition-colors ${tab === "sanitize" ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
          >
            Clean metadata
          </button>
        </div>

        {tab === "add" ? (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-text">
              Password to open (leave blank to skip)
              <input
                type="password"
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-text">
              Owner password (to change permissions later — defaults to the open password)
              <input
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text">Restrict</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {PERMISSION_TOGGLES.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 text-sm text-text-muted">
                    <input type="checkbox" checked={permissions[p.key] === false} onChange={() => togglePermission(p.key)} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : tab === "remove" ? (
          <>
            <label className="flex flex-col gap-1.5 text-sm text-text">
              Password
              <input
                type="password"
                autoFocus
                value={removePassword}
                onChange={(e) => setRemovePassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRemoveProtection();
                }}
                className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
              />
            </label>
            {removeError && <p className="text-xs text-danger">{removeError}</p>}
            <p className="text-xs text-text-faint">Either the open password or the owner password works.</p>
          </>
        ) : (
          <>
            <p className="text-xs text-text-faint">
              Removes hidden data the visible page content doesn't show — useful before sharing a document outside
              your organization.
            </p>
            <div className="flex flex-col gap-2">
              {SANITIZE_TOGGLES.map((t) => (
                <label key={t.key} className="flex items-start gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={!!sanitizeOptions[t.key]}
                    onChange={(e) => setSanitizeOptions((prev) => ({ ...prev, [t.key]: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>
                    {t.label}
                    <span className="block text-xs text-text-faint">{t.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {sanitizeReport && (
              <div className="rounded-[--radius-sm] border border-border bg-bg-elevated/60 p-3 text-xs text-text-muted">
                <p className="mb-1 font-medium text-text">Result</p>
                <ul className="flex flex-col gap-0.5">
                  <li>{sanitizeReport.clearedInfoMetadata ? "✓ Document info cleared" : "– No document info to clear"}</li>
                  <li>{sanitizeReport.removedXmpMetadata ? "✓ XMP metadata removed" : "– No XMP metadata found"}</li>
                  <li>
                    {sanitizeReport.removedEmbeddedFileCount > 0
                      ? `✓ ${sanitizeReport.removedEmbeddedFileCount} embedded file${sanitizeReport.removedEmbeddedFileCount === 1 ? "" : "s"} removed`
                      : "– No embedded files found"}
                  </li>
                  <li>{sanitizeReport.removedJavaScript ? "✓ Embedded scripts removed" : "– No embedded scripts found"}</li>
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
