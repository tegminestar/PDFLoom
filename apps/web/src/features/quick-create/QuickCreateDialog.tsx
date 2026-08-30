import { extractHighlights, getPdfWorkerClient } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "../../app/store";
import { buildImagePptx, canvasToPngBlob } from "./export";
import { COLOR_SCHEMES, drawTemplate, TEMPLATES, type ColorScheme, type TemplateId } from "./templates";

const PREVIEW_MAX_WIDTH = 380;

/**
 * "Quick Create": repurposes the open document into a flyer, social
 * graphic, or slide — AI-extracted title/bullets (quick-create-content.ts,
 * reusing summarize.ts's already-verified model rather than a second one
 * for a very similar job) laid out on one of three hand-built canvas
 * templates (templates.ts). Every export format (PNG/PDF/PPTX) embeds the
 * exact same rendered canvas image rather than three independent layout
 * implementations — what's in the preview is what you get.
 */
export function QuickCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useLoomStore((s) => s.document);
  const meta = useLoomStore((s) => s.meta);
  const storage = useLoomStore((s) => s.storage);

  const [templateId, setTemplateId] = useState<TemplateId>("social");
  const [scheme, setScheme] = useState<ColorScheme>(COLOR_SCHEMES[0]!);
  const [title, setTitle] = useState("");
  const [bulletsText, setBulletsText] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const bullets = bulletsText.split("\n").map((b) => b.trim()).filter(Boolean);

  useEffect(() => {
    if (!open || !meta) return;
    setTitle((prev) => prev || meta.name.replace(/\.pdf$/i, ""));
  }, [open, meta]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !open) return;
    canvas.width = template.width;
    canvas.height = template.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawTemplate(ctx, templateId, { title: title || "Untitled", bullets }, scheme, template.width, template.height);
  }, [open, templateId, scheme, title, bulletsText, template.width, template.height, bullets]);

  const handleExtract = async () => {
    if (!doc || !meta) return;
    setIsExtracting(true);
    try {
      let fullText = "";
      for (let pageNumber = 1; pageNumber <= meta.pageCount; pageNumber++) {
        setStatus(`Reading page ${pageNumber} of ${meta.pageCount}…`);
        fullText += `${await doc.getFullPageText(pageNumber)}\n\n`;
      }
      if (!fullText.trim()) {
        toast.warning("No extractable text", "This document doesn't have selectable text to summarize — it may be a scanned image.");
        return;
      }
      const highlights = await extractHighlights(fullText, title || meta.name.replace(/\.pdf$/i, ""), {
        onProgress: (info) => {
          if (info.stage === "loading-model") {
            const d = info.detail;
            setStatus(d.stage === "downloading" ? `Downloading AI model… ${Math.round(d.progressPct)}%` : "Preparing the AI model…");
          } else {
            setStatus("Extracting highlights…");
          }
        },
      });
      setBulletsText(highlights.bullets.join("\n"));
    } catch (error) {
      toast.error("Couldn't extract highlights", error instanceof Error ? error.message : undefined);
    } finally {
      setIsExtracting(false);
      setStatus(null);
    }
  };

  const baseName = (meta?.name ?? "quick-create").replace(/\.pdf$/i, "");

  const handleExportPng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsExporting(true);
    try {
      const blob = await canvasToPngBlob(canvas);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${baseName}-${templateId}.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Exported as PNG");
    } catch (error) {
      toast.error("Couldn't export PNG", error instanceof Error ? error.message : undefined);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPdf = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsExporting(true);
    try {
      const blob = await canvasToPngBlob(canvas);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const client = await getPdfWorkerClient();
      const pdfBytes = await client.imagesToPdf([{ bytes, type: "png" }], { mode: "auto" });
      // .save() (a direct browser download), not .saveAs() (which opens a
      // native "choose a location" picker) — this is a freshly-generated
      // export, same as the PNG/PPTX buttons right next to it, and all
      // three should behave the same way rather than one popping a
      // different kind of dialog.
      await storage.save(new Uint8Array(pdfBytes), `${baseName}-${templateId}.pdf`);
      toast.success("Exported as PDF");
    } catch (error) {
      toast.error("Couldn't export PDF", error instanceof Error ? error.message : undefined);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPptx = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsExporting(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const blob = await buildImagePptx(dataUrl, canvas.width, canvas.height);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${baseName}-${templateId}.pptx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Exported as PowerPoint");
    } catch (error) {
      toast.error("Couldn't export PowerPoint", error instanceof Error ? error.message : undefined);
    } finally {
      setIsExporting(false);
    }
  };

  const previewHeight = (template.height / template.width) * PREVIEW_MAX_WIDTH;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quick Create"
      description="Turns this document into a flyer, social graphic, or slide — AI extracts a title and a few highlights for you to edit before exporting."
      width={680}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="secondary" size="sm" disabled={isExporting} onClick={() => void handleExportPptx()}>
            Export PowerPoint
          </Button>
          <Button variant="secondary" size="sm" disabled={isExporting} onClick={() => void handleExportPdf()}>
            Export PDF
          </Button>
          <Button variant="primary" size="sm" disabled={isExporting} onClick={() => void handleExportPng()}>
            Export PNG
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className="flex w-56 shrink-0 flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-text">Template</span>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                className={`rounded-[--radius-sm] px-2.5 py-1.5 text-left text-sm ${templateId === t.id ? "bg-primary text-primary-text" : "bg-surface text-text-muted hover:text-text"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-text">Color scheme</span>
            <div className="flex gap-2">
              {COLOR_SCHEMES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.label}
                  onClick={() => setScheme(s)}
                  style={{ background: s.background }}
                  className={`h-8 w-8 rounded-full border-2 ${scheme.id === s.id ? "border-primary" : "border-border-strong"}`}
                >
                  <span className="sr-only">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <Button variant="ai" size="sm" disabled={isExtracting || !doc} onClick={() => void handleExtract()}>
            {isExtracting ? "Extracting…" : "Extract from document"}
          </Button>
          {status && <p className="text-xs text-ai">{status}</p>}

          <label className="flex flex-col gap-1.5 text-sm text-text">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-sm text-text outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-text">
            Highlights (one per line)
            <textarea
              value={bulletsText}
              onChange={(e) => setBulletsText(e.target.value)}
              rows={5}
              className="resize-none rounded-[--radius-sm] border border-border-strong bg-surface px-2 py-1.5 text-sm text-text outline-none"
            />
          </label>
        </div>

        <div className="flex flex-1 items-center justify-center rounded-[--radius-md] bg-surface p-3">
          <canvas
            ref={canvasRef}
            style={{ width: PREVIEW_MAX_WIDTH, height: previewHeight }}
            className="rounded-[--radius-sm] shadow-[0_1px_8px_var(--loom-canvas-shadow)]"
          />
        </div>
      </div>
    </Dialog>
  );
}
