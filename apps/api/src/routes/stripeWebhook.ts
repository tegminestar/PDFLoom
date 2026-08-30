import type { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

/**
 * The only place entitlement is ever granted or revoked — Stripe calls
 * this directly (not the browser), so it's the source of truth for
 * `is_pro`, verified via the webhook signature rather than trusting
 * anything the client claims. createCheckoutSession.ts only ever starts a
 * checkout; it never writes to the profiles table itself.
 *
 * Requires the RAW request body for signature verification — mounted with
 * express.raw() in server.ts, not the global express.json() parser, or
 * Stripe's signature check would be verifying already-reserialized JSON
 * instead of the exact bytes Stripe signed.
 */
export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
    console.error("Missing required environment configuration for stripeWebhook");
    res.status(500).send("Server is not configured yet");
    return;
  }

  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  const stripe = new Stripe(stripeSecretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);
  } catch (error) {
    console.warn("Stripe webhook signature verification failed", error);
    res.status(400).send("Invalid signature");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id ?? session.metadata?.supabase_user_id;
      if (!userId) {
        console.warn("checkout.session.completed had no client_reference_id/supabase_user_id — cannot grant entitlement");
        break;
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          is_pro: true,
          stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id,
          stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);
      if (error) console.error("Failed to grant Pro entitlement", error);
      break;
    }
    case "customer.subscription.deleted":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const isActive = subscription.status === "active" || subscription.status === "trialing";
      const { error } = await supabase
        .from("profiles")
        .update({ is_pro: isActive, updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", subscription.id);
      if (error) console.error("Failed to update Pro entitlement from subscription event", error);
      break;
    }
    default:
      break;
  }

  res.status(200).json({ received: true });
}
