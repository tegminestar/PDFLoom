import express from "express";
import {
  checkAnalyticsAccess,
  deleteUserAccount,
  getAnalyticsSummary,
  setUserPro,
  setUserRole,
  trackAnalyticsEvent,
} from "./routes/analytics";
import { createCheckoutSession } from "./routes/createCheckoutSession";
import { createPortalSession } from "./routes/createPortalSession";
import { submitFeedback } from "./routes/feedback";
import {
  createSignatureRequest,
  declineSignature,
  deleteSignatureRequest,
  getSignatureRequestStatus,
  getSignerView,
  listSignatureRequests,
  submitSignature,
  voidSignatureRequest,
} from "./routes/signatureRequests";
import {
  createSignatureTemplate,
  deleteSignatureTemplate,
  getSignatureTemplate,
  listSignatureTemplates,
} from "./routes/signatureTemplates";
import { stripeWebhook } from "./routes/stripeWebhook";

const app = express();

// Mounted before anything else, body-parsing included: CORS headers must be
// present on every response, error responses too. This used to run *after*
// express.json() below, which meant any error thrown during body parsing
// (a request over the default 100kb JSON limit, most commonly — exactly
// what a real, non-trivial signature document's base64 body hits almost
// immediately) skipped this middleware entirely and fell through to
// Express's default error handler with no CORS headers at all. The browser
// then reports that as an opaque "Failed to fetch" network error — not the
// real 413 — which is indistinguishable from an actual outage client-side.
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

// The webhook route needs Stripe's exact original bytes to verify the
// signature — mounted with the raw-body parser scoped to just this one
// route, before the general JSON parser below would otherwise consume it.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  stripeWebhook(req, res).catch((error: unknown) => {
    console.error("Unhandled error in stripeWebhook", error);
    res.status(500).json({ error: "Internal error" });
  });
});

// Express's own default (100kb) is far too small for this API's actual
// payloads: signature-request/template creation sends the whole PDF as
// base64 (~33% larger than raw) in the JSON body. 50mb comfortably covers
// real-world documents — scanned contracts, multi-page leases — with
// headroom above the ~25MB most e-sign products cap at.
app.use(express.json({ limit: "50mb" }));

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

app.post("/api/analytics/users/:id/role", (req, res) => {
  setUserRole(req, res).catch((error: unknown) => {
    console.error("Unhandled error in setUserRole", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.post("/api/analytics/users/:id/pro", (req, res) => {
  setUserPro(req, res).catch((error: unknown) => {
    console.error("Unhandled error in setUserPro", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.delete("/api/analytics/users/:id", (req, res) => {
  deleteUserAccount(req, res).catch((error: unknown) => {
    console.error("Unhandled error in deleteUserAccount", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.post("/api/signature-requests", (req, res) => {
  createSignatureRequest(req, res).catch((error: unknown) => {
    console.error("Unhandled error in createSignatureRequest", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.get("/api/signature-requests", (req, res) => {
  listSignatureRequests(req, res).catch((error: unknown) => {
    console.error("Unhandled error in listSignatureRequests", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.get("/api/signature-requests/:id", (req, res) => {
  getSignatureRequestStatus(req, res).catch((error: unknown) => {
    console.error("Unhandled error in getSignatureRequestStatus", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.post("/api/signature-requests/:id/void", (req, res) => {
  voidSignatureRequest(req, res).catch((error: unknown) => {
    console.error("Unhandled error in voidSignatureRequest", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.delete("/api/signature-requests/:id", (req, res) => {
  deleteSignatureRequest(req, res).catch((error: unknown) => {
    console.error("Unhandled error in deleteSignatureRequest", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.post("/api/signature-templates", (req, res) => {
  createSignatureTemplate(req, res).catch((error: unknown) => {
    console.error("Unhandled error in createSignatureTemplate", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.get("/api/signature-templates", (req, res) => {
  listSignatureTemplates(req, res).catch((error: unknown) => {
    console.error("Unhandled error in listSignatureTemplates", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.get("/api/signature-templates/:id", (req, res) => {
  getSignatureTemplate(req, res).catch((error: unknown) => {
    console.error("Unhandled error in getSignatureTemplate", error);
    res.status(500).json({ error: "Internal error" });
  });
});

app.delete("/api/signature-templates/:id", (req, res) => {
  deleteSignatureTemplate(req, res).catch((error: unknown) => {
    console.error("Unhandled error in deleteSignatureTemplate", error);
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

app.post("/api/sign/:token/decline", (req, res) => {
  declineSignature(req, res).catch((error: unknown) => {
    console.error("Unhandled error in declineSignature", error);
    res.status(500).json({ error: "Internal error" });
  });
});

// Catches body-parsing errors (a request over express.json()'s limit,
// malformed JSON) before they reach Express's default HTML error page —
// the client always does `await res.json()`, which would itself throw on
// an HTML body, masking the real error behind a second, unrelated one.
// `_next` is unused but required: Express only recognizes a 4-arg function
// as error-handling middleware, and this handler always terminates the
// response itself rather than delegating further.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && typeof err === "object" && "type" in err && (err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: "That document is too large to send for signature (50MB limit)." });
    return;
  }
  console.error("Unhandled error", err);
  res.status(500).json({ error: "Internal error" });
});

// Azure App Service (Linux) injects the port to listen on via PORT.
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`PDFLoom API listening on port ${port}`);
});
