import type { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import * as geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";

const TABLE = "analytics_events";
const MAX_EVENT_NAME_LENGTH = 100;
const MAX_PATH_LENGTH = 300;

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Azure App Service (Linux) appends ":<port>" to every hop in
 * X-Forwarded-For (e.g. "203.0.113.4:52142"), which geoip-lite's lookup()
 * silently fails on since it expects a bare IP. IPv6 hops are additionally
 * bracketed ("[::1]:52142") when a port is present.
 */
function stripPort(ip: string): string {
  const trimmed = ip.trim();
  const bracketed = /^\[(.+)\]:\d+$/.exec(trimmed);
  if (bracketed) return bracketed[1] ?? trimmed;
  if ((trimmed.match(/:/g) ?? []).length === 1) return trimmed.split(":")[0] ?? trimmed;
  return trimmed;
}

function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(",")[0];
  if (firstHop?.trim()) return stripPort(firstHop);
  return req.socket.remoteAddress ?? undefined;
}

function classifyDevice(deviceType: string | undefined): string {
  if (deviceType === "mobile") return "Mobile";
  if (deviceType === "tablet") return "Tablet";
  if (deviceType === "smarttv") return "TV";
  return "Desktop";
}

/**
 * Public beacon endpoint — replaces the Plausible script tag. Never trusts
 * or stores anything identifying beyond what Plausible itself already
 * captured (event name + page path + referrer); device/browser/OS/geo are
 * derived server-side from the request itself, the same signals any web
 * server access log already sees. Errors here never surface as a failed
 * request — analytics must never break the app it's measuring, mirroring
 * apps/web/src/app/analytics.ts's own try/catch contract.
 */
export async function trackAnalyticsEvent(req: Request, res: Response): Promise<void> {
  res.status(204).end();

  try {
    const body = req.body as { eventName?: unknown; path?: unknown; referrer?: unknown };
    const eventName = typeof body.eventName === "string" ? body.eventName.slice(0, MAX_EVENT_NAME_LENGTH) : "";
    if (!eventName) return;

    const supabase = getSupabaseAdmin();
    if (!supabase) return;

    const path = typeof body.path === "string" ? body.path.slice(0, MAX_PATH_LENGTH) : null;
    const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, MAX_PATH_LENGTH) : null;

    const parser = new UAParser(req.headers["user-agent"]);
    const result = parser.getResult();
    const device = classifyDevice(result.device.type);
    const browser = result.browser.name ?? null;
    const os = result.os.name ?? null;

    const ip = getClientIp(req);
    const geo = ip ? geoip.lookup(ip) : null;

    await supabase.from(TABLE).insert({
      event_name: eventName,
      path,
      referrer,
      device,
      browser,
      os,
      country: geo?.country ?? null,
      city: geo?.city ?? null,
    });
  } catch (error) {
    console.error("Unhandled error recording analytics event", error);
  }
}

interface AnalyticsEventRow {
  event_name: string;
  path: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  created_at: string;
}

function topCounts(rows: AnalyticsEventRow[], key: keyof AnalyticsEventRow, limit: number): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/**
 * Owner-only dashboard data. Gated the same way createCheckoutSession is —
 * a verified Supabase session — plus one extra check: the session's email
 * must match ANALYTICS_OWNER_EMAIL. Everyone else (including other signed-in
 * PDFLoom accounts) gets 403; an unset env var fails closed (nobody passes)
 * rather than open.
 */
export async function getAnalyticsSummary(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  const ownerEmail = process.env.ANALYTICS_OWNER_EMAIL;
  const supabase = getSupabaseAdmin();
  if (!supabase || !ownerEmail) {
    res.status(500).json({ error: "Analytics dashboard is not configured yet" });
    return;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  if (userData.user.email?.toLowerCase() !== ownerEmail.toLowerCase()) {
    res.status(403).json({ error: "Not authorized" });
    return;
  }

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const { data, error } = await supabase
    .from(TABLE)
    .select("event_name, path, device, browser, os, country, city, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("Error querying analytics_events", error);
    res.status(500).json({ error: "Couldn't load analytics" });
    return;
  }

  const rows = (data ?? []) as AnalyticsEventRow[];
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const last7Days = rows.filter((r) => now - new Date(r.created_at).getTime() <= 7 * DAY_MS).length;
  const last30Days = rows.filter((r) => now - new Date(r.created_at).getTime() <= 30 * DAY_MS).length;

  const dailyBuckets = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    dailyBuckets.set(day, 0);
  }
  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    if (dailyBuckets.has(day)) dailyBuckets.set(day, (dailyBuckets.get(day) ?? 0) + 1);
  }

  res.status(200).json({
    totalEvents: rows.length,
    last7Days,
    last30Days,
    dailyEvents: [...dailyBuckets.entries()].map(([date, count]) => ({ date, count })),
    deviceBreakdown: topCounts(rows, "device", 8),
    browserBreakdown: topCounts(rows, "browser", 8),
    osBreakdown: topCounts(rows, "os", 8),
    countryBreakdown: topCounts(rows, "country", 8),
    topEvents: topCounts(rows, "event_name", 10),
    topPaths: topCounts(rows, "path", 10),
    recent: rows.slice(0, 20).map((r) => ({
      eventName: r.event_name,
      path: r.path,
      device: r.device,
      browser: r.browser,
      os: r.os,
      country: r.country,
      city: r.city,
      createdAt: r.created_at,
    })),
  });
}
