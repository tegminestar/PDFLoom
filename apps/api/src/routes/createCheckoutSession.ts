import type { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

/**
 * Starts a Stripe Checkout session for the PDFLoom Pro subscription. The
 * caller must be a signed-in Supabase user (their access token, verified
 * here — this route never trusts a client-supplied user id). The completed
 * checkout is matched back to this user via `client_reference_id` in
 * stripeWebhook.ts, which is the only place entitlement actually gets
 * written — this route only ever starts a session, never grants access.
 */
export async function createCheckoutSession(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";

  if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey || !priceId) {
    console.error("Missing required environment configuration for createCheckoutSession");
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  const user = userData.user;

  const stripe = new Stripe(stripeSecretKey);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: user.id,
    customer_email: user.email,
    success_url: `${appUrl}/app?upgraded=1`,
    cancel_url: `${appUrl}/app?upgrade_canceled=1`,
    metadata: { supabase_user_id: user.id },
  });

  if (!session.url) {
    res.status(500).json({ error: "Stripe did not return a checkout URL" });
    return;
  }
  res.status(200).json({ url: session.url });
}
