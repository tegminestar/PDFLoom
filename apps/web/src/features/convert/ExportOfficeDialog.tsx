import { Button, Dialog, toast } from "@pdfloom/ui";
import { useState } from "react";
import { useLoomStore } from "../../app/store";
import { buildDocx, buildPptx, buildXlsx } from "./officeExport";

type OfficeFormat = "docx" | "xlsx" | "pptx";

const FORMATS: { id: OfficeFormat; label: string; ext: string }[] = [
  { id: "docx", label: "Word (.docx)", ext: "docx" },
  { id: "xlsx", label: "Excel (.xlsx)", ext: "xlsx" },
  { id: "pptx", label: "PowerPoint (.pptx)", ext: "pptx" },
];

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Best-effort PDF → Office export. There's no layout/table/column analysis
 * available purely client-side — this extracts each page's text (the same
 * extraction search already uses) and lays it out plainly in the target
 * format. Honestly framed in the dialog copy rather than implying
 * Acrobat-grade layout-preserving conversion.
 */
export function ExportOfficeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);

  const [format, setFormat] = useState<OfficeFormat>("docx");
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!doc || !meta) return;
    setIsExporting(true);
    try {
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= meta.pageCount; pageNumber++) {
        pages.push(await doc.getFullPageText(pageNumber));
      }
      const baseName = meta.name.replace(/\.pdf$/i, "");
      const target = FORMATS.find((f) => f.id === format)!;

      const blob = format === "docx" ? await buildDocx(pages, baseName) : format === "xlsx" ? await buildXlsx(pages) : await buildPptx(pages, baseName);
      downloadBlob(blob, `${baseName}.${target.ext}`);
      toast.success(`Exported as ${target.label}`, "Text only — layout, images, and tables aren't preserved.");
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't export this document", error instanceof Error ? error.message : undefined);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export to Office"
      description="Extracts the document's text into an editable Office file — layout, images, and tables aren't preserved."
      width={420}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={isExporting} onClick={() => void handleExport()}>
            {isExporting ? "Exporting…" : "Export"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFormat(f.id)}
            className={`flex items-center justify-between rounded-[--radius-sm] border px-3 py-2.5 text-left text-sm transition-colors ${
              format === f.id ? "border-primary bg-primary-muted text-text" : "border-border-strong bg-surface text-text-muted hover:text-text"
            }`}
          >
            {f.label}
            {format === f.id && <span className="text-xs text-primary">Selected</span>}
          </button>
        ))}
        <p className="text-xs text-text-faint">
          Best for documents that are mostly text. Tables are detected naively (tab or multi-space separated) — complex layouts won't come
          through cleanly.
        </p>
      </div>
    </Dialog>
  );
}
