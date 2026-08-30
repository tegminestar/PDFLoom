import express from "express";
import { createCheckoutSession } from "./routes/createCheckoutSession";
import { createPortalSession } from "./routes/createPortalSession";
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
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

// Azure App Service (Linux) injects the port to listen on via PORT.
const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`PDFLoom API listening on port ${port}`);
});
