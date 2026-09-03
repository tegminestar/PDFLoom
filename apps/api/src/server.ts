import express from "express";
import { checkAnalyticsAccess, getAnalyticsSummary, trackAnalyticsEvent } from "./routes/analytics";
import { createCheckoutSession } from "./routes/createCheckoutSession";
import { createPortalSession } from "./routes/createPortalSession";
import { submitFeedback } from "./routes/feedback";
import { createSignatureRequest, getSignatureRequestStatus, getSignerView, submitSignature } from "./routes/signatureRequests";
import { stripeWebhook } from "./routes/stripeWebhook";

const app = express();

// The webhook route needs Stripe's exact original bytes to verify the
// signature — mounted with the raw-body parser scoped to just this one
// route, before the general JSON parser below would otherwise consume it.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  stripeWebhook(req, res).catch((error: unknown) => {
    console.error("Unhandled error in stripeWebhook", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.use(express.json());

const corsOrigin = process.env.APP_URL ?? "http://localhost:5173";
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// A pure backend — there's no page to serve here, just so a visit to the
// bare URL (e.g. someone checking the deployment in a browser) doesn't
// look like it's broken.
app.get("/", (_req, res) => {
  res.status(200).json({ service: "PDFLoom API", ok: true, health: "/api/health" });
});

app.post("/api/feedback", (req, res) => {
  submitFeedback(req, res).catch((error: unknown) => {
    console.error("Unhandled error in submitFeedback", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.post("/api/checkout", (req, res) => {
  createCheckoutSession(req, res).catch((error: unknown) => {
    console.error("Unhandled error in createCheckoutSession", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.post("/api/billing-portal", (req, res) => {
  createPortalSession(req, res).catch((error: unknown) => {
    console.error("Unhandled error in createPortalSession", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.post("/api/analytics/track", (req, res) => {
  trackAnalyticsEvent(req, res).catch((error: unknown) => {
    console.error("Unhandled error in trackAnalyticsEvent", error);
  });
});

app.get("/api/analytics/summary", (req, res) => {
  getAnalyticsSummary(req, res).catch((error: unknown) => {
    console.error("Unhandled error in getAnalyticsSummary", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.get("/api/analytics/is-owner", (req, res) => {
  checkAnalyticsAccess(req, res).catch((error: unknown) => {
    console.error("Unhandled error in checkAnalyticsAccess", error);
    res.status(200).json({ isOwner: false });
  });
});

app.post("/api/signature-requests", (req, res) => {
  createSignatureRequest(req, res).catch((error: unknown) => {
    console.error("Unhandled error in createSignatureRequest", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.get("/api/signature-requests/:id", (req, res) => {
  getSignatureRequestStatus(req, res).catch((error: unknown) => {
    console.error("Unhandled error in getSignatureRequestStatus", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.get("/api/sign/:token", (req, res) => {
  getSignerView(req, res).catch((error: unknown) => {
    console.error("Unhandled error in getSignerView", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.post("/api/sign/:token", (req, res) => {
  submitSignature(req, res).catch((error: unknown) => {
    console.error("Unhandled error in submitSignature", error);
    res.status(500).json({ error: "Internal error" });
  });
});

// Azure App Service (Linux) injects the port to listen on via PORT.
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`PDFLoom API listening on port ${port}`);
});
