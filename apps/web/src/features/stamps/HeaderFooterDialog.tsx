import { getPdfWorkerClient } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";

export function HeaderFooterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);

  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("Page {page} of {total}");
  const [isApplying, setIsApplying] = useState(false);

  const hasContent = headerText.trim().length > 0 || footerText.trim().length > 0;

  const handleApply = async () => {
    if (!doc || !hasContent) return;
    setIsApplying(true);
    try {
      const client = await getPdfWorkerClient();
      const bytes = await client.addHeaderFooter(await doc.getRawBytes(), {
        ...(headerText.trim() && { headerText: headerText.trim() }),
        ...(footerText.trim() && { footerText: footerText.trim() }),
      });
      await applyPdfMutation(bytes);
      toast.success("Header/footer added");
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't add header/footer", error instanceof Error ? error.message : undefined);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add header & footer"
      description="Use {page} and {total} to insert page numbers."
      width={440}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!hasContent || isApplying} onClick={() => void handleApply()}>
            {isApplying ? "Applying…" : "Add to every page"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-text">
          Header text
          <input
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            placeholder="e.g. Company Name — Confidential"
            className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-text">
          Footer text
          <input
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder="e.g. Page {page} of {total}"
            className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 outline-none placeholder:text-text-faint focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
          />
        </label>
      </div>
    </Dialog>
  );
}
