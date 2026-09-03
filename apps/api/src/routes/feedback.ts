import type { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

// Kept server-side deliberately — the frontend never sees this address (not
// in the bundle, not in any network request it makes), only our own /api/feedback.
const FEEDBACK_RECIPIENT = "sales@tegminestar.com";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Proxies a feedback submission to FormSubmit.co server-side. No email-
 * sending credential is provisioned for this app yet, so this is a
 * pragmatic v1: FormSubmit still does the actual delivery, but the
 * recipient address never appears anywhere the browser can see it. Origin/
 * Referer are set explicitly because FormSubmit's ajax endpoint otherwise
 * treats a header-less server-to-server request as "not a real webpage."
 */
async function sendToFormSubmit(category: string | undefined, message: string, replyTo: string | undefined, page: string | undefined): Promise<boolean> {
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${FEEDBACK_RECIPIENT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://pdfloom.app",
        Referer: "https://pdfloom.app/app",
      },
      body: JSON.stringify({
        _subject: `PDFLoom feedback: ${category ?? "General feedback"}`,
        category: category ?? "General feedback",
        message,
        replyTo: replyTo?.trim() || "(not provided)",
        page: page ?? "(unknown)",
      }),
    });
    const body = (await res.json().catch(() => null)) as { success?: string } | null;
    if (!res.ok || body?.success === "false") {
      console.error("FormSubmit rejected feedback", res.status, body);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Couldn't reach FormSubmit", error);
    return false;
  }
}

async function saveFeedbackCopy(category: string | undefined, message: string, replyTo: string | undefined, page: string | undefined): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return false;
    const { error } = await supabase.from("feedback_submissions").insert({
      category: category ?? null,
      message,
      reply_to: replyTo?.trim() || null,
      page: page ?? null,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Couldn't save feedback copy to Supabase", error);
    return false;
  }
}

/**
 * Two independent delivery paths so a FormSubmit outage never silently
 * loses feedback: as long as either the email or the Supabase copy lands,
 * the submitter sees success and the team can still see it (in their
 * inbox, or in the /analytics dashboard). Only fails if both do.
 */
export async function submitFeedback(req: Request, res: Response): Promise<void> {
  const { category, message, replyTo, page } = req.body as { category?: string; message?: string; replyTo?: string; page?: string };
  if (!message || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const trimmedMessage = message.trim();

  const [emailed, saved] = await Promise.all([
    sendToFormSubmit(category, trimmedMessage, replyTo, page),
    saveFeedbackCopy(category, trimmedMessage, replyTo, page),
  ]);

  if (!emailed && !saved) {
    res.status(502).json({ error: "Couldn't deliver feedback right now" });
    return;
  }
  res.status(200).json({ ok: true });
}
