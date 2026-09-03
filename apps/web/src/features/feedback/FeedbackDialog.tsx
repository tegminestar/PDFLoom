import { Button, Dialog, toast } from "@pdfloom/ui";
import { Check } from "lucide-react";
import { useState } from "react";
import { apiUrl } from "../../app/supabase";

type Category = "bug" | "feature" | "general";

const CATEGORY_LABEL: Record<Category, string> = {
  bug: "Something's broken",
  feature: "Feature request",
  general: "General feedback",
};

/**
 * Submits to our own backend, which forwards to FormSubmit.co server-side
 * (see apps/api/src/routes/feedback.ts) — no email-sending credential is
 * provisioned for this app yet (same gap as multi-party signing's
 * auto-invite emails), and proxying through our own API keeps the actual
 * recipient address out of the bundle and every request this page makes.
 * This is the one deliberate exception to "nothing leaves your device":
 * feedback text (and an optional reply-to email) leaves on purpose, since
 * the whole point is reaching a person. Nothing else here touches the open
 * document.
 */
export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [category, setCategory] = useState<Category>("general");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCategory("general");
      setEmail("");
      setMessage("");
      setSent(false);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast.warning("Write a message first");
      return;
    }
    setIsSending(true);
    try {
      const res = await fetch(`${apiUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: CATEGORY_LABEL[category],
          message: message.trim(),
          replyTo: email.trim() || undefined,
          page: window.location.href,
        }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setSent(true);
    } catch (error) {
      toast.error("Couldn't send feedback", error instanceof Error ? error.message : "Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title="Send feedback"
      description={sent ? undefined : "Goes straight to our team — this is the one place a short note leaves your device on purpose."}
      width={440}
      footer={
        sent ? (
          <Button variant="primary" size="sm" onClick={() => handleClose(false)}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => handleClose(false)} disabled={isSending}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={isSending || !message.trim()} onClick={() => void handleSubmit()}>
              {isSending ? "Sending…" : "Send"}
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-muted text-primary">
            <Check className="h-6 w-6" />
          </div>
          <p className="text-sm text-text-muted">Thanks — we read every note. We'll reply if you left an email.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 rounded-[--radius-sm] bg-surface p-1">
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`flex-1 rounded-[--radius-sm] py-1.5 text-xs font-medium transition-colors ${category === c ? "bg-primary text-primary-text" : "text-text-muted hover:text-text"}`}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-sm text-text">
            Your message
            <textarea
              autoFocus
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              className="resize-none rounded-[--radius-sm] border border-border-strong bg-surface p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-text">
            Email (optional, so we can reply)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-9 rounded-[--radius-sm] border border-border-strong bg-surface px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]"
            />
          </label>
        </div>
      )}
    </Dialog>
  );
}
