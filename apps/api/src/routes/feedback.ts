import type { Request, Response } from "express";

// Kept server-side deliberately — the frontend never sees this address (not
// in the bundle, not in any network request it makes), only our own /api/feedback.
const FEEDBACK_RECIPIENT = "sales@tegminestar.com";

/**
 * Proxies a feedback submission to FormSubmit.co server-side. No email-
 * sending credential is provisioned for this app yet, so this is a
 * pragmatic v1: FormSubmit still does the actual delivery, but the
 * recipient address never appears anywhere the browser can see it.
 */
export async function submitFeedback(req: Request, res: Response): Promise<void> {
  const { category, message, replyTo, page } = req.body as { category?: string; message?: string; replyTo?: string; page?: string };
  if (!message || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const formsubmitRes = await fetch(`https://formsubmit.co/ajax/${FEEDBACK_RECIPIENT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      _subject: `PDFLoom feedback: ${category ?? "General feedback"}`,
      category: category ?? "General feedback",
      message: message.trim(),
      replyTo: replyTo?.trim() || "(not provided)",
      page: page ?? "(unknown)",
    }),
  });

  if (!formsubmitRes.ok) {
    res.status(502).json({ error: "Couldn't deliver feedback right now" });
    return;
  }
  res.status(200).json({ ok: true });
}
