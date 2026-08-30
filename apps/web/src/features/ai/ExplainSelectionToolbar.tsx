import { Button } from "@pdfloom/ui";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useLoomStore } from "../../app/store";
import { ExplainClauseDialog } from "./ExplainClauseDialog";

const MIN_SELECTION_CHARS = 8;

interface FloatingSelection {
  text: string;
  left: number;
  top: number;
}

/**
 * Global (mounted once) floating "Explain" button that appears above any
 * plain-text selection made while just reading (not while another mode —
 * annotate/fill/edit/redact/sign — is active, each of which already has
 * its own selection-driven UI, e.g. SelectionMarkupToolbar for annotate).
 * Reads window.getSelection() directly for the text content — unlike
 * SelectionMarkupToolbar, nothing here gets written back into the PDF, so
 * there's no quad/PDF-point-space conversion needed, just the plain text.
 */
export function ExplainSelectionToolbar() {
  const mainView = useLoomStore((s) => s.mainView);
  const annotateOpen = useLoomStore((s) => s.annotateOpen);
  const formFillOpen = useLoomStore((s) => s.formFillOpen);
  const editOpen = useLoomStore((s) => s.editOpen);
  const redactOpen = useLoomStore((s) => s.redactOpen);
  const signOpen = useLoomStore((s) => s.signOpen);
  const doc = useLoomStore((s) => s.document);

  const isPlainReading = mainView === "read" && !annotateOpen && !formFillOpen && !editOpen && !redactOpen && !signOpen;

  const [selection, setSelection] = useState<FloatingSelection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogText, setDialogText] = useState("");

  useEffect(() => {
    if (!isPlainReading || !doc) {
      setSelection(null);
      return;
    }

    const handler = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || text.length < MIN_SELECTION_CHARS) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const anchorEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      if (!anchorEl?.closest("[data-page-number]")) {
        setSelection(null);
        return;
      }
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) {
        setSelection(null);
        return;
      }
      const first = rects[0]!;
      setSelection({ text, left: first.left + first.width / 2, top: first.top - 44 });
    };

    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [isPlainReading, doc]);

  const handleExplain = () => {
    if (!selection) return;
    setDialogText(selection.text);
    setDialogOpen(true);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <>
      {selection && (
        <div className="loom-pop fixed z-50 -translate-x-1/2" style={{ left: selection.left, top: Math.max(8, selection.top) }}>
          <Button variant="ai" size="sm" onClick={handleExplain}>
            <Sparkles className="h-4 w-4" />
            Explain
          </Button>
        </div>
      )}
      <ExplainClauseDialog open={dialogOpen} onOpenChange={setDialogOpen} clauseText={dialogText} />
    </>
  );
}
