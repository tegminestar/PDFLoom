import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

/**
 * The only place entitlement is ever granted or revoked — Stripe calls
 * this directly (not the browser), so it's the source of truth for
 * `is_pro`, verified via the webhook signature rather than trusting
 * anything the client claims. createCheckoutSession.ts only ever starts a
 * checkout; it never writes to the profiles table itself.
 */
app.http("stripeWebhook", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "stripe/webhook",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
      context.error("Missing required environment configuration for stripeWebhook");
      return { status: 500, body: "Server is not configured yet" };
    }

    const signature = request.headers.get("stripe-signature");
    const rawBody = await request.text();
    if (!signature) {
      return { status: 400, body: "Missing stripe-signature header" };
    }

    const stripe = new Stripe(stripeSecretKey);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      context.warn("Stripe webhook signature verification failed", error);
      return { status: 400, body: "Invalid signature" };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id ?? session.metadata?.supabase_user_id;
        if (!userId) {
          context.warn("checkout.session.completed had no client_reference_id/supabase_user_id — cannot grant entitlement");
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
        if (error) context.error("Failed to grant Pro entitlement", error);
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
        if (error) context.error("Failed to update Pro entitlement from subscription event", error);
        break;
      }
      default:
        break;
    }

    return { status: 200, jsonBody: { received: true } };
  },
});
