import { Button, Dialog, toast } from "@pdfloom/ui";
import { Check, Copy, MapPin } from "lucide-react";
import { useState } from "react";
import { useLoomStore } from "../../app/store";
import { isReviewAvailable, useReviewStore } from "./reviewStore";

/**
 * "Live Review" — real-time shared comment pins for people who each have
 * their own copy of the same document open, synced via a Supabase
 * Realtime channel (see supabaseReviewProvider.ts) carrying only small
 * Yjs update payloads — comment text, position, author name. The document
 * itself never passes through it. Not collaborative editing of the PDF's
 * actual content: see review-session.ts's docstring for why that's a
 * deliberate scope line, not an oversight.
 */
export function LiveReviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const sessionCode = useReviewStore((s) => s.sessionCode);
  const isConnected = useReviewStore((s) => s.isConnected);
  const participantName = useReviewStore((s) => s.participantName);
  const setParticipantName = useReviewStore((s) => s.setParticipantName);
  const comments = useReviewStore((s) => s.comments);
  const isPlacingComment = useReviewStore((s) => s.isPlacingComment);
  const setIsPlacingComment = useReviewStore((s) => s.setIsPlacingComment);
  const startSession = useReviewStore((s) => s.startSession);
  const joinSession = useReviewStore((s) => s.joinSession);
  const leaveSession = useReviewStore((s) => s.leaveSession);
  const setCurrentPage = useLoomStore((s) => s.setCurrentPage);

  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopyCode = async () => {
    if (!sessionCode) return;
    try {
      await navigator.clipboard.writeText(sessionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  if (!isReviewAvailable) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title="Live Review" width={420}>
        <p className="text-sm text-text-muted">
          Live Review isn't set up on this deployment — it needs the same optional backend project account sign-in uses (just its
          real-time messaging, not sign-in itself). Nothing else in PDFLoom needs this to work.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Live Review"
      description="Real-time comment pins with anyone who has this same document open — never the document itself, only small comment messages."
      width={420}
      footer={
        sessionCode ? (
          <Button variant="secondary" size="sm" onClick={leaveSession}>
            Leave session
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-text">Your name</span>
          <input
            value={participantName}
            onChange={(e) => setParticipantName(e.target.value)}
            placeholder="Shown next to your comments"
            className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
          />
        </label>

        {!sessionCode ? (
          <div className="flex flex-col gap-4">
            <Button variant="primary" size="sm" onClick={startSession} className="self-start">
              Start a new session
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-text-faint">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter a session code"
                className="h-9 flex-1 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
              />
              <Button variant="secondary" size="sm" disabled={!joinCode.trim()} onClick={() => joinSession(joinCode)}>
                Join
              </Button>
            </div>
            <p className="text-xs text-text-faint">
              Make sure everyone has the exact same document open first — pin positions are shared, but the file itself never is.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2 rounded-[--radius-md] border border-border bg-surface p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-text-faint">Session code</span>
                <span className="font-mono text-sm font-semibold tracking-widest text-text">{sessionCode}</span>
              </div>
              <button type="button" onClick={() => void handleCopyCode()} className="flex items-center gap-1 text-xs text-text-muted hover:text-text">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {!isConnected && <p className="text-xs text-text-faint">Couldn't connect — check your connection and try leaving and starting again.</p>}

            <Button
              variant={isPlacingComment ? "primary" : "secondary"}
              size="sm"
              onClick={() => setIsPlacingComment(!isPlacingComment)}
              className="self-start"
            >
              <MapPin className="h-4 w-4" />
              {isPlacingComment ? "Click the page to place it…" : "Add a comment pin"}
            </Button>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-text">{comments.length === 0 ? "No comments yet" : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}</span>
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {[...comments]
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCurrentPage(c.pageIndex + 1);
                        onOpenChange(false);
                      }}
                      className="flex flex-col gap-1 rounded-[--radius-sm] border border-border-strong bg-surface p-2.5 text-left hover:bg-surface-hover"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold" style={{ color: c.authorColor }}>
                          {c.authorName}
                        </span>
                        <span className="text-xs text-text-faint">Page {c.pageIndex + 1}</span>
                      </div>
                      <span className="truncate text-sm text-text">{c.text}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
