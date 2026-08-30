import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

/**
 * Starts a Stripe Checkout session for the PDFLoom Pro subscription. The
 * caller must be a signed-in Supabase user (their access token, verified
 * here — this function never trusts a client-supplied user id). The
 * completed checkout is matched back to this user via `client_reference_id`
 * in stripeWebhook.ts, which is the only place entitlement actually gets
 * written — this function only ever starts a session, never grants access.
 */
app.http("createCheckoutSession", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "checkout",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const authHeader = request.headers.get("authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return { status: 401, jsonBody: { error: "Missing Authorization header" } };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRO_PRICE_ID;
    const appUrl = process.env.APP_URL ?? "http://localhost:5173";

    if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey || !priceId) {
      context.error("Missing required environment configuration for createCheckoutSession");
      return { status: 500, jsonBody: { error: "Server is not configured yet" } };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return { status: 401, jsonBody: { error: "Invalid or expired session" } };
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
      return { status: 500, jsonBody: { error: "Stripe did not return a checkout URL" } };
    }
    return { status: 200, jsonBody: { url: session.url } };
  },
});
