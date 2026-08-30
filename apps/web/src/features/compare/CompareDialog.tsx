import { PdfDocument } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import type { CompareTarget } from "../../app/store";

/**
 * Picks a second, independent PDF to compare the currently open document
 * against. Deliberately does NOT go through the app's single-document
 * storage/open flow (openViaPicker/storage.openFilePicker) — the chosen
 * file becomes a second, parallel PdfDocument instance that only
 * CompareView touches, so it can never collide with or replace the real
 * open document.
 */
export function CompareDialog({
  open,
  onOpenChange,
  onPicked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPicked: (target: CompareTarget) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleFile = async (file: File) => {
    setIsLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await PdfDocument.load(bytes);
      onPicked({ doc, name: file.name });
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't open that file for comparison", error instanceof Error ? error.message : undefined);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Compare"
      description="Pick another PDF to compare against the document you have open — text and visual differences are shown page by page, entirely on your device."
      width={420}
      footer={
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isLoading}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={isLoading}
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center gap-2 rounded-[--radius-md] border border-dashed border-border-strong bg-surface px-4 py-8 text-center transition-colors hover:border-primary hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
        >
          <FileUp className="h-6 w-6 text-text-muted" />
          <span className="text-sm font-medium text-text">{isLoading ? "Opening…" : "Choose a PDF to compare"}</span>
          <span className="text-xs text-text-faint">This document is only used for comparison — it isn't added to your files.</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>
    </Dialog>
  );
}
