import type { PdfDocument } from "@pdfloom/core";
import { cn } from "@pdfloom/ui";
import { useEffect, useState } from "react";
import { useLoomStore } from "../../app/store";

export interface SearchHighlightOverlayProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
}

interface ScreenHighlight {
  rect: { x: number; y: number; width: number; height: number };
  isActive: boolean;
}

/**
 * Draws a box over each search match's actual on-page location — not just
 * the page-level ring PageCanvas already shows — reusing findTextRects
 * (the same character-range-to-rect mapping redaction/smart-redact use) so
 * a match is genuinely findable at a glance instead of requiring the user
 * to re-read the whole page it landed on.
 */
export function SearchHighlightOverlay({ doc, pageNumber, scale, rotation }: SearchHighlightOverlayProps) {
  const searchResults = useLoomStore((s) => s.searchResults);
  const activeSearchIndex = useLoomStore((s) => s.activeSearchIndex);

  const [highlights, setHighlights] = useState<ScreenHighlight[]>([]);

  useEffect(() => {
    const matchesOnPage = searchResults
      .map((match, index) => ({ match, index }))
      .filter(({ match }) => match.pageNumber === pageNumber);

    if (matchesOnPage.length === 0) {
      setHighlights([]);
      return;
    }

    let cancelled = false;
    Promise.all(
      matchesOnPage.map(async ({ match, index }) => {
        const pdfRects = await doc.findTextRects(pageNumber, match.startIndex, match.startIndex + match.matchedText.length);
        const screenRects = await Promise.all(pdfRects.map((r) => doc.pdfRectToScreenRect(pageNumber, scale, rotation, r)));
        return screenRects.map((rect) => ({ rect, isActive: index === activeSearchIndex }));
      }),
    ).then((groups) => {
      if (!cancelled) setHighlights(groups.flat());
    });
    return () => {
      cancelled = true;
    };
    // searchResults/activeSearchIndex are read fresh above rather than added
    // as deps directly — they only ever change via runSearch/goToSearchIndex,
    // both of which also change one of the primitives already depended on
    // below (activeSearchIndex itself, or searchResults' own reference).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, rotation, searchResults, activeSearchIndex]);

  if (highlights.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {highlights.map((h, i) => (
        <div
          key={i}
          className={cn("absolute rounded-[2px]", h.isActive ? "bg-ai/50 ring-2 ring-ai" : "bg-ai/25")}
          style={{ left: h.rect.x, top: h.rect.y, width: h.rect.width, height: h.rect.height }}
        />
      ))}
    </div>
  );
}
