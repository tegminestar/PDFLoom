import type { PdfDocument } from "@pdfloom/core";
import { Button } from "@pdfloom/ui";
import { useEffect, useState } from "react";
import { useReviewStore } from "./reviewStore";

export interface ReviewCommentOverlayProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
}

const PIN_SIZE_PT = 20;

/**
 * Renders "Live Review" comment pins for one page — small colored markers
 * at each comment's position, plus (while placing) a click-to-drop
 * interaction for adding a new one. Positions are stored in PDF point
 * space (see review-session.ts) and converted per-render via
 * pdfRectToScreenRect, the same pattern FormFieldOverlay uses, so pins
 * stay correctly placed across zoom/rotation and are identical for every
 * participant regardless of their own viewport.
 */
export function ReviewCommentOverlay({ doc, pageNumber, scale, rotation }: ReviewCommentOverlayProps) {
  const session = useReviewStore((s) => s.session);
  const comments = useReviewStore((s) => s.comments);
  const isPlacingComment = useReviewStore((s) => s.isPlacingComment);
  const setIsPlacingComment = useReviewStore((s) => s.setIsPlacingComment);
  const addCommentAt = useReviewStore((s) => s.addCommentAt);
  const removeComment = useReviewStore((s) => s.removeComment);
  const participantName = useReviewStore((s) => s.participantName);

  const [screenRects, setScreenRects] = useState<Map<string, { x: number; y: number; width: number; height: number }>>(new Map());
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [draftScreenPoint, setDraftScreenPoint] = useState<{ x: number; y: number } | null>(null);
  const [draftPdfPoint, setDraftPdfPoint] = useState<{ x: number; y: number } | null>(null);
  const [draftText, setDraftText] = useState("");

  const commentsOnPage = comments.filter((c) => c.pageIndex === pageNumber - 1);

  useEffect(() => {
    if (!session || commentsOnPage.length === 0) {
      setScreenRects(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(
      commentsOnPage.map((c) => doc.pdfRectToScreenRect(pageNumber, scale, rotation, { x: c.x, y: c.y, width: c.width, height: c.height }).then((r) => [c.id, r] as const)),
    ).then((entries) => {
      if (!cancelled) setScreenRects(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // commentsOnPage is derived fresh each render from `comments` — length+ids joined is a sufficient change signal without re-running on every unrelated field mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, rotation, session, commentsOnPage.map((c) => c.id).join(",")]);

  if (!session) return null;

  const handlePageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPlacingComment) return;
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const pdfPoint = await doc.screenPointToPdfPoint(pageNumber, scale, rotation, screenX, screenY);
    setDraftScreenPoint({ x: screenX, y: screenY });
    setDraftPdfPoint(pdfPoint);
    setDraftText("");
    setIsPlacingComment(false);
  };

  const saveDraft = () => {
    if (!draftText.trim() || !draftPdfPoint) {
      setDraftScreenPoint(null);
      return;
    }
    addCommentAt(pageNumber - 1, { x: draftPdfPoint.x, y: draftPdfPoint.y - PIN_SIZE_PT, width: PIN_SIZE_PT, height: PIN_SIZE_PT }, draftText);
    setDraftScreenPoint(null);
    setDraftPdfPoint(null);
  };

  return (
    // pointer-events-none unless actively placing a pin — without this, a
    // review session being merely *open* silently ate every click meant
    // for whatever tool is actually in use (Edit, Annotate, Forms...),
    // since this div covers the full page at z-20 regardless. Existing
    // pins re-enable pointer-events individually so they stay clickable
    // either way.
    <div
      className={isPlacingComment ? "absolute inset-0 z-20 cursor-crosshair" : "pointer-events-none absolute inset-0 z-20"}
      onClick={(e) => void handlePageClick(e)}
    >
      {commentsOnPage.map((comment) => {
        const rect = screenRects.get(comment.id);
        if (!rect) return null;
        const isOpen = openPinId === comment.id;
        return (
          <div key={comment.id} className="pointer-events-auto absolute" style={{ left: rect.x, top: rect.y }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenPinId(isOpen ? null : comment.id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white shadow-md"
              style={{ backgroundColor: comment.authorColor }}
              title={`${comment.authorName}: ${comment.text}`}
            >
              {comment.authorName.charAt(0).toUpperCase()}
            </button>
            {isOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute left-6 top-0 z-30 flex w-56 flex-col gap-2 rounded-[--radius-md] border border-border-strong bg-surface p-3 text-sm shadow-[--shadow-floating]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: comment.authorColor }}>
                    {comment.authorName}
                  </span>
                  {comment.authorName === (participantName.trim() || "Anonymous") && (
                    <button type="button" onClick={() => removeComment(comment.id)} className="text-xs text-text-faint hover:text-text">
                      Delete
                    </button>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-text">{comment.text}</p>
              </div>
            )}
          </div>
        );
      })}

      {draftScreenPoint && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto absolute z-30 flex w-56 flex-col gap-2 rounded-[--radius-md] border border-border-strong bg-surface p-3 text-sm shadow-[--shadow-floating]"
          style={{ left: draftScreenPoint.x, top: draftScreenPoint.y }}
        >
          <textarea
            autoFocus
            rows={2}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Add a comment…"
            className="resize-none rounded-[--radius-sm] border border-border-strong bg-bg p-2 text-text outline-none focus-visible:border-primary"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDraftScreenPoint(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={saveDraft} disabled={!draftText.trim()}>
              Add pin
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
