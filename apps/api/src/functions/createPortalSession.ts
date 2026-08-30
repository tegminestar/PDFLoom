import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

/**
 * Opens Stripe's hosted Customer Portal for an already-Pro user, so they
 * can update payment details or cancel — mirrors createCheckoutSession's
 * auth pattern (verify the caller's Supabase token server-side), but reads
 * their existing stripe_customer_id from profiles instead of creating a
 * new subscription.
 */
app.http("createPortalSession", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "billing-portal",
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const authHeader = request.headers.get("authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return { status: 401, jsonBody: { error: "Missing Authorization header" } };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const appUrl = process.env.APP_URL ?? "http://localhost:5173";

    if (!supabaseUrl || !supabaseServiceRoleKey || !stripeSecretKey) {
      context.error("Missing required environment configuration for createPortalSession");
      return { status: 500, jsonBody: { error: "Server is not configured yet" } };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return { status: 401, jsonBody: { error: "Invalid or expired session" } };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userData.user.id)
      .single();
    if (profileError || !profile?.stripe_customer_id) {
      return { status: 400, jsonBody: { error: "No billing account found for this user yet" } };
    }

    const stripe = new Stripe(stripeSecretKey);
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl}/app`,
    });

    return { status: 200, jsonBody: { url: portalSession.url } };
  },
});
