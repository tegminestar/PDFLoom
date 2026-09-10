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
  userId?: string;
  isOwnerEmail?: boolean;
}

/**
 * Strict single-account check — true iff the session's email matches
 * ANALYTICS_OWNER_EMAIL. This is the gate for every mutation (role changes,
 * Pro overrides, account deletion): an 'admin'-role account can *view* the
 * dashboard (see checkDashboardAccess) but can never grant itself or anyone
 * else more access, so promoting an account to 'admin' can't be leveraged
 * into a privilege-escalation chain.
 */
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
  return { ok: true, status: 200, userId: userData.user.id };
}

/**
 * View-only gate for the dashboard itself: the true owner, OR any account
 * the owner has promoted to profiles.role = 'admin'. Deliberately looser
 * than checkOwnerAuth — every mutation endpoint still requires the strict
 * owner-only check, so this only ever grants read access.
 */
async function checkDashboardAccess(req: Request, supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<OwnerCheck> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) return { ok: false, status: 401, error: "Missing Authorization header" };

  const ownerEmail = process.env.ANALYTICS_OWNER_EMAIL;
  if (!ownerEmail) return { ok: false, status: 500, error: "Analytics dashboard is not configured yet" };

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return { ok: false, status: 401, error: "Invalid or expired session" };

  if (userData.user.email?.toLowerCase() === ownerEmail.toLowerCase()) {
    return { ok: true, status: 200, userId: userData.user.id, isOwnerEmail: true };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if ((profile as { role?: string } | null)?.role === "admin") {
    return { ok: true, status: 200, userId: userData.user.id, isOwnerEmail: false };
  }
  return { ok: false, status: 403, error: "Not authorized" };
}

/**
 * Cheap yes/no check the signed-in-only "Analytics" menu item uses to
 * decide whether to show itself — deliberately separate from
 * getAnalyticsSummary so checking "can I view this" never requires shipping
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
  const result = await checkDashboardAccess(req, supabase);
  res.status(200).json({ isOwner: result.ok });
}

/**
 * Dashboard data. Viewable by the owner or any profiles.role = 'admin'
 * account; the response's canManageUsers flag tells the UI whether *this*
 * viewer may also see the user-management action buttons (owner only —
 * see checkOwnerAuth). An unset ANALYTICS_OWNER_EMAIL fails closed (nobody
 * passes) rather than open.
 */
export async function getAnalyticsSummary(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Analytics dashboard is not configured yet" });
    return;
  }

  const auth = await checkDashboardAccess(req, supabase);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const canManageUsers = auth.isOwnerEmail === true;

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
    canManageUsers,
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
 * MyQRCreate's user-admin panel. auth.users has emails and signup dates;
 * profiles has is_pro/role — joined here since neither table alone has
 * both. isOwnerAccount flags the ANALYTICS_OWNER_EMAIL row specifically so
 * the dashboard UI can hide the mutation buttons on it (the owner can't
 * demote, de-Pro, or delete themselves through this panel).
 */
async function fetchUserSummary(supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>, now: number) {
  const [{ data: userPage, error: userError }, { data: profileRows, error: profileError }] = await Promise.all([
    supabase.auth.admin.listUsers({ perPage: 1000 }),
    supabase.from("profiles").select("id, is_pro, role"),
  ]);

  if (userError || profileError) {
    console.error("Error loading user summary", userError ?? profileError);
    return null;
  }

  const profileById = new Map(
    (profileRows ?? []).map((p: { id: string; is_pro: boolean; role: string | null }) => [p.id, p]),
  );
  const ownerEmail = process.env.ANALYTICS_OWNER_EMAIL?.toLowerCase();
  const users = (userPage?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? "(no email)",
    isPro: profileById.get(u.id)?.is_pro ?? false,
    role: profileById.get(u.id)?.role === "admin" ? "admin" : "user",
    isOwnerAccount: ownerEmail != null && u.email?.toLowerCase() === ownerEmail,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getIdParam(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
}

/**
 * Owner-only: promote/demote an account's dashboard-view access. Granting
 * 'admin' only ever grants read access to /analytics (checkDashboardAccess)
 * — it can never be used to reach any of the mutation endpoints below,
 * which all re-check checkOwnerAuth (the single ANALYTICS_OWNER_EMAIL
 * account) independent of this column.
 */
export async function setUserRole(req: Request, res: Response): Promise<void> {
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

  const targetId = getIdParam(req);
  if (!UUID_RE.test(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const role = (req.body as { role?: unknown }).role;
  if (role !== "admin" && role !== "user") {
    res.status(400).json({ error: "role must be 'admin' or 'user'" });
    return;
  }

  const { error } = await supabase.from("profiles").update({ role }).eq("id", targetId);
  if (error) {
    console.error("Error updating user role", error);
    res.status(500).json({ error: "Couldn't update role" });
    return;
  }
  res.status(200).json({ ok: true });
}

/**
 * Owner-only: manual Pro-access override, independent of Stripe. PDFLoom
 * has no trial/grace-period concept to "extend" (that's MyQRCreate's model,
 * not this one) — the honest equivalent of comping someone access is
 * toggling the same is_pro flag Stripe's webhook writes, without touching
 * stripe_subscription_id, so a real subscription's own status isn't
 * clobbered by this override and vice versa.
 */
export async function setUserPro(req: Request, res: Response): Promise<void> {
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

  const targetId = getIdParam(req);
  if (!UUID_RE.test(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const isPro = (req.body as { isPro?: unknown }).isPro;
  if (typeof isPro !== "boolean") {
    res.status(400).json({ error: "isPro must be a boolean" });
    return;
  }

  const { error } = await supabase.from("profiles").update({ is_pro: isPro }).eq("id", targetId);
  if (error) {
    console.error("Error updating user Pro status", error);
    res.status(500).json({ error: "Couldn't update Pro status" });
    return;
  }
  res.status(200).json({ ok: true });
}

/**
 * Owner-only, irreversible: deletes the account from auth.users; profiles'
 * own row cascades via its `on delete cascade` foreign key (schema.sql).
 * Refuses to delete the owner's own account so this panel can never be
 * used to lock the owner out of the dashboard.
 */
export async function deleteUserAccount(req: Request, res: Response): Promise<void> {
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

  const targetId = getIdParam(req);
  if (!UUID_RE.test(targetId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (targetId === auth.userId) {
    res.status(400).json({ error: "Can't delete the owner's own account" });
    return;
  }

  const { error } = await supabase.auth.admin.deleteUser(targetId);
  if (error) {
    console.error("Error deleting user account", error);
    res.status(500).json({ error: "Couldn't delete account" });
    return;
  }
  res.status(200).json({ ok: true });
}
