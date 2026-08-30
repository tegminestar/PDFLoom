import type { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

/**
 * Opens Stripe's hosted Customer Portal for an already-Pro user, so they
 * can update payment details or cancel — mirrors createCheckoutSession's
 * auth pattern (verify the caller's Supabase token server-side), but reads
 * their existing stripe_customer_id from profiles instead of creating a
 * new subscription.
 */
export async function createPortalSession(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";

  if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey) {
    console.error("Missing required environment configuration for createPortalSession");
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userData.user.id)
    .single();
  if (profileError || !profile?.stripe_customer_id) {
    res.status(400).json({ error: "No billing account found for this user yet" });
    return;
  }

  const stripe = new Stripe(stripeSecretKey);
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${appUrl}/app`,
  });

  res.status(200).json({ url: portalSession.url });
}
