import { apiUrl } from "./supabase";

/**
 * Only in production builds. In dev, apps/api is almost never also running
 * alongside `pnpm dev` — Plausible's old script tag hit a real, always-up
 * public endpoint either way, so it never surfaced this, but a fetch/
 * sendBeacon to our own dev-time URL with nothing listening logs a real
 * "Failed to load resource: net::ERR_CONNECTION_REFUSED" line to the
 * console. That's browser-level (not something a .catch() can suppress)
 * and not just cosmetic — it broke e2e specs asserting on a clean console.
 * A developer who wants to exercise analytics locally can still do so via
 * `vite build && vite preview` against a locally-running apps/api.
 */
const isAnalyticsConfigured = import.meta.env.PROD;

/**
 * The one route in the app whose path segment is itself a bearer credential
 * (a signer's unguessable access token, see SignerPage.tsx / SECURITY.md) —
 * redacted so it's structurally impossible for a future trackEvent() call
 * anywhere near that page to leak a real token into analytics_events.path,
 * which the /analytics dashboard then displays back. No call site does
 * this today, but path capture happens here, not per call site, so this is
 * the one place that can actually guarantee it never does.
 */
function sanitizePath(pathname: string): string {
  return pathname.replace(/^\/sign\/.+$/, "/sign/:token");
}

/**
 * Beacons a lightweight event to PDFLoom's own analytics endpoint
 * (apps/api's POST /api/analytics/track) — replaces the paid Plausible
 * Cloud script this used to call through window.plausible. Never sends
 * document content, filenames, or anything user-identifying: just an event
 * name (with any props folded into it — e.g. trackEvent("feature_opened",
 * {feature: "edit"}) becomes "feature_opened_edit") plus the current path
 * and referrer, consistent with the "your files never leave your device"
 * claim on the landing page/FAQ. Device, browser, OS, and coarse geo are
 * derived server-side from the request itself (ua-parser-js + geoip-lite,
 * both free/offline) — the client never sends them.
 *
 * Uses sendBeacon (falling back to a keepalive fetch) so a track call
 * right before navigating away still lands. Every failure mode — no
 * network, sendBeacon unsupported, the API unreachable — is swallowed, so
 * analytics can never break the app it's measuring.
 */
export function trackEvent(eventName: string, props?: Record<string, string | number | boolean>): void {
  if (!isAnalyticsConfigured) return;
  try {
    const suffix = props ? Object.values(props).map(String).join("_") : "";
    const payload = JSON.stringify({
      eventName: suffix ? `${eventName}_${suffix}` : eventName,
      path: sanitizePath(window.location.pathname),
      referrer: document.referrer || undefined,
    });

    const url = `${apiUrl}/api/analytics/track`;
    const blob = new Blob([payload], { type: "application/json" });
    const beaconed = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, blob);
    if (beaconed) return;

    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  } catch {
    // Analytics must never break the app it's measuring.
  }
}
