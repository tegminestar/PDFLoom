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

const FEATURE_OPENED_PREFIX = "feature_opened_";
const FEATURE_LABELS: Record<string, string> = {
  annotate: "Annotate",
  fill_form: "Fill form",
  edit: "Edit",
  redact: "Redact",
  sign: "Sign",
};

function titleCase(key: string): string {
  return key
    .split("_")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** "Popular QR types"'s PDFLoom equivalent — which tool panels people actually open, decoded from trackEvent's composite "feature_opened_<feature>" event names into labels a non-engineer can read. */
function popularFeatures(rows: AnalyticsEventRow[], limit: number): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.event_name.startsWith(FEATURE_OPENED_PREFIX)) continue;
    const key = row.event_name.slice(FEATURE_OPENED_PREFIX.length);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ name: FEATURE_LABELS[key] ?? titleCase(key), count }));
}

interface OwnerCheck {
  ok: boolean;
  status: number;
  error?: string;
}

async function checkOwnerAuth(req: Request, supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<OwnerCheck> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) return { ok: false, status: 401, error: "Missing Authorization header" };

  const ownerEmail = process.env.ANALYTICS_OWNER_EMAIL;
  if (!ownerEmail) return { ok: false, status: 500, error: "Analytics dashboard is not configured yet" };

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return { ok: false, status: 401, error: "Invalid or expired session" };

  if (userData.user.email?.toLowerCase() !== ownerEmail.toLowerCase()) {
    return { ok: false, status: 403, error: "Not authorized" };
  }
  return { ok: true, status: 200 };
}

/**
 * Cheap yes/no check the signed-in-only "Analytics" menu item uses to
 * decide whether to show itself — deliberately separate from
 * getAnalyticsSummary so checking "am I the owner" never requires shipping
 * ANALYTICS_OWNER_EMAIL to the browser bundle (same reasoning as
 * feedback.ts keeping its recipient address server-side only) or running
 * the full analytics query just to render a menu item. Always 200 — "no"
 * is a normal answer here, not an error.
 */
export async function checkAnalyticsAccess(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(200).json({ isOwner: false });
    return;
  }
  const result = await checkOwnerAuth(req, supabase);
  res.status(200).json({ isOwner: result.ok });
}

/**
 * Owner-only dashboard data. Gated the same way createCheckoutSession is —
 * a verified Supabase session — plus one extra check: the session's email
 * must match ANALYTICS_OWNER_EMAIL. Everyone else (including other signed-in
 * PDFLoom accounts) gets 403; an unset env var fails closed (nobody passes)
 * rather than open.
 */
export async function getAnalyticsSummary(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Analytics dashboard is not configured yet" });
    return;
  }

  const auth = await checkOwnerAuth(req, supabase);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
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

  const [usersResult, feedbackResult] = await Promise.all([
    fetchUserSummary(supabase, now),
    fetchFeedbackSummary(supabase),
  ]);

  res.status(200).json({
    totalEvents: rows.length,
    last7Days,
    last30Days,
    dailyEvents: dailyBuckets(rows.map((r) => r.created_at), 30, now),
    deviceBreakdown: topCounts(rows, "device", 8),
    browserBreakdown: topCounts(rows, "browser", 8),
    osBreakdown: topCounts(rows, "os", 8),
    countryBreakdown: topCounts(rows, "country", 8),
    popularFeatures: popularFeatures(rows, 8),
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
    users: usersResult,
    feedback: feedbackResult,
  });
}

function dailyBuckets(isoDates: string[], days: number, now: number): { date: string; count: number }[] {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    buckets.set(new Date(now - i * DAY_MS).toISOString().slice(0, 10), 0);
  }
  for (const iso of isoDates) {
    const day = iso.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

/**
 * "Total users" / "Paying" / signups-over-time — PDFLoom's equivalent of
 * MyQRCreate's user-admin panel, read-only for now (no role concept exists
 * here to gate mutations on, and account deletion/role changes are a
 * separate, deliberately-deferred decision). auth.users has emails and
 * signup dates; profiles has is_pro — joined here since neither table
 * alone has both.
 */
async function fetchUserSummary(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, now: number) {
  const [{ data: userPage, error: userError }, { data: profileRows, error: profileError }] = await Promise.all([
    supabase.auth.admin.listUsers({ perPage: 1000 }),
    supabase.from("profiles").select("id, is_pro"),
  ]);

  if (userError || profileError) {
    console.error("Error loading user summary", userError ?? profileError);
    return null;
  }

  const proById = new Map((profileRows ?? []).map((p: { id: string; is_pro: boolean }) => [p.id, p.is_pro]));
  const users = (userPage?.users ?? []).map((u) => ({
    email: u.email ?? "(no email)",
    isPro: proById.get(u.id) ?? false,
    joinedAt: u.created_at,
  }));

  const DAY_MS = 24 * 60 * 60 * 1000;
  const total = users.length;
  const pro = users.filter((u) => u.isPro).length;
  const last7Days = users.filter((u) => now - new Date(u.joinedAt).getTime() <= 7 * DAY_MS).length;

  return {
    total,
    pro,
    free: total - pro,
    last7Days,
    dailySignups: dailyBuckets(users.map((u) => u.joinedAt), 30, now),
    recent: [...users]
      .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
      .slice(0, 50),
  };
}

/** "Product feedback" panel — the feedback form's own copy, kept purely for the dashboard (see feedback.ts, which still delivers the real one by email). */
async function fetchFeedbackSummary(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  const { data, error, count } = await supabase
    .from("feedback_submissions")
    .select("category, message, reply_to, page, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Error loading feedback summary", error);
    return null;
  }

  return {
    total: count ?? data?.length ?? 0,
    recent: (data ?? []).map((f) => ({
      category: f.category as string | null,
      message: f.message as string,
      replyTo: f.reply_to as string | null,
      page: f.page as string | null,
      createdAt: f.created_at as string,
    })),
  };
}
