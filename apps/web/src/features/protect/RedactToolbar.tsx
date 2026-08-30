import { TopBar, TopBarSection, Button as ToolbarButton, Separator, toast } from "@pdfloom/ui";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useLoomStore } from "../../app/store";
import { PageNumberField } from "../viewer/PageNumberField";
import { ZoomControls } from "../viewer/ZoomControls";
import { SmartRedactDialog } from "./SmartRedactDialog";

const REDACT_DPI = 200;

export function RedactToolbar() {
  const doc = useLoomStore((s) => s.document);
  const redactBoxes = useLoomStore((s) => s.redactBoxes);
  const isApplying = useLoomStore((s) => s.isApplyingRedactions);
  const setRedactOpen = useLoomStore((s) => s.setRedactOpen);
  const clearRedactBoxes = useLoomStore((s) => s.clearRedactBoxes);
  const applyRedactions = useLoomStore((s) => s.applyRedactions);
  const [smartDetectOpen, setSmartDetectOpen] = useState(false);

  const pageIndices = [...new Set(redactBoxes.map((b) => b.pageIndex))];

  const handleApply = async () => {
    if (!doc || pageIndices.length === 0) return;
    try {
      const scale = REDACT_DPI / 72;
      const renderedPages = new Map<number, { widthPt: number; heightPt: number; jpegBytes: Uint8Array }>();
      for (const pageIndex of pageIndices) {
        const pageNumber = pageIndex + 1;
        const dims = await doc.getPageDimensions(pageNumber);
        const canvas = document.createElement("canvas");
        await doc.renderPage(pageNumber, { canvas, scale });
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Couldn't rasterize page ${pageNumber}`))), "image/jpeg", 0.85);
        });
        renderedPages.set(pageIndex, { widthPt: dims.widthPt, heightPt: dims.heightPt, jpegBytes: new Uint8Array(await blob.arrayBuffer()) });
      }
      await applyRedactions(renderedPages);
      toast.success(
        `Redacted ${pageIndices.length} page${pageIndices.length === 1 ? "" : "s"}`,
        "Those pages are now flattened images — the covered content is gone, not just hidden.",
      );
    } catch (error) {
      toast.error("Couldn't apply redactions", error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <TopBar>
      <TopBarSection>
        <span className="mr-2 text-sm font-semibold text-text">Redact</span>
        <PageNumberField />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <ZoomControls />
      </TopBarSection>

      <TopBarSection align="center">
        <span className="text-xs text-text-faint">
          {redactBoxes.length === 0
            ? "Drag to mark content for redaction"
            : `${redactBoxes.length} box${redactBoxes.length === 1 ? "" : "es"} across ${pageIndices.length} page${pageIndices.length === 1 ? "" : "s"}`}
        </span>
      </TopBarSection>

      <TopBarSection align="end">
        <ToolbarButton variant="ai" size="sm" onClick={() => setSmartDetectOpen(true)} disabled={isApplying}>
          <Sparkles className="h-4 w-4" />
          Smart detect
        </ToolbarButton>
        {redactBoxes.length > 0 && (
          <ToolbarButton variant="ghost" size="sm" onClick={clearRedactBoxes} disabled={isApplying}>
            Clear
          </ToolbarButton>
        )}
        <ToolbarButton variant="secondary" size="sm" onClick={() => setRedactOpen(false)} disabled={isApplying}>
          Cancel
        </ToolbarButton>
        <ToolbarButton variant="primary" size="sm" disabled={redactBoxes.length === 0 || isApplying} onClick={() => void handleApply()}>
          {isApplying ? "Applying…" : "Apply redactions"}
        </ToolbarButton>
      </TopBarSection>
      <SmartRedactDialog open={smartDetectOpen} onOpenChange={setSmartDetectOpen} />
    </TopBar>
  );
}
