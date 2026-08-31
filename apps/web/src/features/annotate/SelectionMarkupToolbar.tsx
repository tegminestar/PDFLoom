import { getPdfWorkerClient, type Quad } from "@pdfloom/core";
import { Button, toast } from "@pdfloom/ui";
import { Highlighter, Strikethrough, Underline } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLoomStore, type AnnotateTool } from "../../app/store";

const MARKUP_TOOLS: Record<Extract<AnnotateTool, "highlight" | "underline" | "strikeout">, { label: string; icon: ReactNode }> = {
  highlight: { label: "Highlight", icon: <Highlighter className="h-4 w-4" /> },
  underline: { label: "Underline", icon: <Underline className="h-4 w-4" /> },
  strikeout: { label: "Strikethrough", icon: <Strikethrough className="h-4 w-4" /> },
};

interface SelectionState {
  pageNumber: number;
  quads: Quad[];
  toolbarLeft: number;
  toolbarTop: number;
}

/**
 * Global (mounted once) floating toolbar that appears above the current
 * text selection while a markup tool (highlight/underline/strikeout) is
 * active in Annotate mode. Text markup annotations anchor to actual glyph
 * quads, so this rides on the browser's native selection over the text
 * layer (see PageCanvas) rather than a drawn gesture.
 */
export function SelectionMarkupToolbar() {
  const annotateOpen = useLoomStore((s) => s.annotateOpen);
  const tool = useLoomStore((s) => s.annotateTool);
  const color = useLoomStore((s) => s.annotateColor);
  const doc = useLoomStore((s) => s.document);
  const zoom = useLoomStore((s) => s.zoom);
  const fitMode = useLoomStore((s) => s.fitMode);
  const fitWidthScale = useLoomStore((s) => s.fitWidthScale);
  const fitPageScale = useLoomStore((s) => s.fitPageScale);
  const viewRotation = useLoomStore((s) => s.viewRotation);
  const applyPdfMutation = useLoomStore((s) => s.applyPdfMutation);
  const scale = fitMode === "width" ? fitWidthScale : fitMode === "page" ? fitPageScale : zoom;

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const isMarkupTool = tool === "highlight" || tool === "underline" || tool === "strikeout";

  useEffect(() => {
    if (!annotateOpen || !isMarkupTool || !doc) {
      setSelection(null);
      return;
    }

    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const anchorEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const pageEl = anchorEl?.closest<HTMLElement>("[data-page-number]");
      if (!pageEl) {
        setSelection(null);
        return;
      }
      const pageNumber = Number(pageEl.dataset.pageNumber);
      const pageRect = pageEl.getBoundingClientRect();
      const clientRects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (clientRects.length === 0) {
        setSelection(null);
        return;
      }

      const quads: Quad[] = clientRects.map((r) => ({
        topLeft: { x: r.left - pageRect.left, y: r.top - pageRect.top },
        topRight: { x: r.right - pageRect.left, y: r.top - pageRect.top },
        bottomLeft: { x: r.left - pageRect.left, y: r.bottom - pageRect.top },
        bottomRight: { x: r.right - pageRect.left, y: r.bottom - pageRect.top },
      }));

      const first = clientRects[0]!;
      setSelection({
        pageNumber,
        quads,
        toolbarLeft: first.left + first.width / 2,
        toolbarTop: first.top - 44,
      });
    };

    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [annotateOpen, isMarkupTool, doc]);

  const handleApply = async () => {
    if (!selection || !doc || !isMarkupTool) return;
    const { pageNumber, quads } = selection;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    try {
      // Screen-space quads (relative to the page element) still need
      // converting to PDF point space at the page's own scale/rotation.
      const pdfQuads: Quad[] = await Promise.all(
        quads.map(async (q) => ({
          topLeft: await doc.screenPointToPdfPoint(pageNumber, scale, viewRotation, q.topLeft.x, q.topLeft.y),
          topRight: await doc.screenPointToPdfPoint(pageNumber, scale, viewRotation, q.topRight.x, q.topRight.y),
          bottomLeft: await doc.screenPointToPdfPoint(pageNumber, scale, viewRotation, q.bottomLeft.x, q.bottomLeft.y),
          bottomRight: await doc.screenPointToPdfPoint(pageNumber, scale, viewRotation, q.bottomRight.x, q.bottomRight.y),
        })),
      );

      const client = await getPdfWorkerClient();
      const bytes = await doc.getRawBytes();
      const fn = tool === "highlight" ? client.addHighlight : tool === "underline" ? client.addUnderline : client.addStrikeOut;
      const newBytes = await fn(bytes, pageNumber - 1, pdfQuads, { color });
      await applyPdfMutation(newBytes);
      toast.success(`Added ${MARKUP_TOOLS[tool].label.toLowerCase()}`);
    } catch (error) {
      toast.error("Couldn't add annotation", error instanceof Error ? error.message : undefined);
    }
  };

  if (!selection || !isMarkupTool) return null;
  const { label, icon } = MARKUP_TOOLS[tool];

  return (
    <div
      className="loom-pop fixed z-50 -translate-x-1/2"
      style={{ left: selection.toolbarLeft, top: Math.max(8, selection.toolbarTop) }}
    >
      <Button variant="ai" size="sm" onClick={() => void handleApply()}>
        {icon}
        {label}
      </Button>
    </div>
  );
}
