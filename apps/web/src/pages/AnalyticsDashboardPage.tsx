import { Button } from "@pdfloom/ui";
import { useEffect, useState } from "react";
import { useAuthStore } from "../app/auth";
import { apiUrl, isAuthConfigured, supabase } from "../app/supabase";
import { AccountDialog } from "../features/account/AccountDialog";
import { BreakdownBars } from "../features/analytics/BreakdownBars";
import { EventsOverTimeChart } from "../features/analytics/EventsOverTimeChart";
import { StatTile } from "../features/analytics/StatTile";

interface AnalyticsSummary {
  totalEvents: number;
  last7Days: number;
  last30Days: number;
  dailyEvents: { date: string; count: number }[];
  deviceBreakdown: { name: string; count: number }[];
  browserBreakdown: { name: string; count: number }[];
  osBreakdown: { name: string; count: number }[];
  countryBreakdown: { name: string; count: number }[];
  popularFeatures: { name: string; count: number }[];
  topPaths: { name: string; count: number }[];
  recent: {
    eventName: string;
    path: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    country: string | null;
    city: string | null;
    createdAt: string;
  }[];
  users: {
    total: number;
    pro: number;
    free: number;
    last7Days: number;
    dailySignups: { date: string; count: number }[];
    recent: { email: string; isPro: boolean; joinedAt: string }[];
  } | null;
  feedback: {
    total: number;
    recent: { category: string | null; message: string; replyTo: string | null; page: string | null; createdAt: string }[];
  } | null;
}

function formatRelativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const centeredPage = "flex min-h-screen items-center justify-center bg-bg p-6";

/**
 * Not linked from any nav — reached only by visiting /analytics directly.
 * Gated in two layers: a Supabase session is required at all (same
 * sign-in flow as billing), and the API's /api/analytics/summary then
 * separately checks that session's email against ANALYTICS_OWNER_EMAIL —
 * this page never sees or trusts that email itself, it just relays
 * whatever the server decides.
 */
export function AnalyticsDashboardPage() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signOut = useAuthStore((s) => s.signOut);

  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    if (isAuthConfigured) initialize();
  }, [initialize]);

  useEffect(() => {
    if (!user || !supabase) return;
    let cancelled = false;
    setLoadingSummary(true);
    setError(null);

    (async () => {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        if (!cancelled) setError("Not signed in");
        return;
      }
      try {
        const res = await fetch(`${apiUrl}/api/analytics/summary`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.status === 403) {
          if (!cancelled) setError("This account isn't authorized to view analytics.");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError(`Couldn't load analytics (${res.status})`);
          return;
        }
        const body = (await res.json()) as AnalyticsSummary;
        if (!cancelled) setSummary(body);
      } catch {
        if (!cancelled) setError("Couldn't reach the analytics service");
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!isAuthConfigured) {
    return (
      <div className={centeredPage}>
        <p className="text-sm text-text-muted">Analytics isn't set up on this deployment.</p>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className={centeredPage}>
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={centeredPage}>
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-text-muted">Sign in to view analytics.</p>
          <Button variant="primary" size="sm" onClick={() => setAccountOpen(true)}>
            Sign in
          </Button>
        </div>
        <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-text">Analytics</h1>
            <p className="text-sm text-text-muted">Last 90 days — self-hosted, nothing shared with a third party.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-faint">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </header>

        {error && <div className="rounded-[--radius-md] border border-border bg-surface p-4 text-sm text-text-muted">{error}</div>}

        {!error && loadingSummary && (
          <div className="rounded-[--radius-md] border border-border bg-surface p-4 text-sm text-text-muted">Loading…</div>
        )}

        {!error && summary && (
          <>
            {summary.users && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-text">Users</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile label="Total users" value={summary.users.total} />
                  <StatTile label="Pro" value={summary.users.pro} />
                  <StatTile label="Free" value={summary.users.free} />
                  <StatTile label="New users, 7 days" value={summary.users.last7Days} />
                </div>
                <div className="rounded-[--radius-md] border border-border bg-surface p-4">
                  <span className="text-sm text-text-muted">New signups per day, last 30 days</span>
                  <EventsOverTimeChart data={summary.users.dailySignups} />
                </div>
              </section>
            )}

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-text">Activity</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile label="Events, last 7 days" value={summary.last7Days} />
                <StatTile label="Events, last 30 days" value={summary.last30Days} />
                <StatTile label="Events, last 90 days" value={summary.totalEvents} />
              </div>

              <div className="rounded-[--radius-md] border border-border bg-surface p-4">
                <span className="text-sm text-text-muted">Events per day, last 30 days</span>
                <EventsOverTimeChart data={summary.dailyEvents} />
              </div>
            </section>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BreakdownBars title="Device" rows={summary.deviceBreakdown} accent="var(--color-primary)" />
              <BreakdownBars title="Browser" rows={summary.browserBreakdown} accent="var(--color-ai)" />
              <BreakdownBars title="OS" rows={summary.osBreakdown} accent="var(--color-success)" />
              <BreakdownBars title="Country" rows={summary.countryBreakdown} accent="var(--color-warning)" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BreakdownBars title="Popular features" rows={summary.popularFeatures} accent="var(--color-primary)" />
              <BreakdownBars title="Top pages" rows={summary.topPaths} accent="var(--color-ai)" />
            </div>

            {summary.feedback && (
              <div className="flex flex-col gap-3 rounded-[--radius-md] border border-border bg-surface p-4">
                <span className="text-sm text-text-muted">
                  Product feedback{summary.feedback.total > 0 ? ` (${summary.feedback.total})` : ""}
                </span>
                {summary.feedback.recent.length === 0 ? (
                  <p className="text-sm text-text-faint">No feedback submitted yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {summary.feedback.recent.map((f, i) => (
                      <div key={`${f.createdAt}-${i}`} className="flex flex-col gap-1 rounded-[--radius-sm] border border-border-strong bg-bg p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-text-faint">{f.category ?? "General feedback"}</span>
                          <span className="text-xs text-text-faint">{formatRelativeTime(f.createdAt)}</span>
                        </div>
                        <p className="text-sm leading-relaxed text-text">{f.message}</p>
                        {f.replyTo && <span className="text-xs text-text-faint">Reply to: {f.replyTo}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {summary.users && (
              <div className="flex flex-col gap-3 rounded-[--radius-md] border border-border bg-surface p-4">
                <span className="text-sm text-text-muted">Users</span>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead>
                      <tr className="text-xs text-text-faint">
                        <th className="pb-2 font-medium">Email</th>
                        <th className="pb-2 font-medium">Plan</th>
                        <th className="pb-2 text-right font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.users.recent.map((u) => (
                        <tr key={u.email} className="border-t border-border">
                          <td className="max-w-56 truncate py-1.5 pr-2 text-text">{u.email}</td>
                          <td className="py-1.5 pr-2">
                            <span
                              className={
                                u.isPro
                                  ? "rounded-full bg-ai-muted px-2 py-0.5 text-xs font-semibold text-ai"
                                  : "rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-faint"
                              }
                            >
                              {u.isPro ? "Pro" : "Free"}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-text-faint">{new Date(u.joinedAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {summary.users.recent.length === 0 && <p className="py-3 text-sm text-text-faint">No users yet</p>}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-[--radius-md] border border-border bg-surface p-4">
              <span className="text-sm text-text-muted">Recent activity</span>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="text-xs text-text-faint">
                      <th className="pb-2 font-medium">Event</th>
                      <th className="pb-2 font-medium">Page</th>
                      <th className="pb-2 font-medium">Device</th>
                      <th className="pb-2 font-medium">Location</th>
                      <th className="pb-2 text-right font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent.map((r, i) => (
                      <tr key={`${r.createdAt}-${i}`} className="border-t border-border">
                        <td className="py-1.5 pr-2 text-text">{r.eventName}</td>
                        <td className="max-w-40 truncate py-1.5 pr-2 text-text-muted">{r.path ?? "—"}</td>
                        <td className="py-1.5 pr-2 text-text-muted">{[r.device, r.browser, r.os].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="py-1.5 pr-2 text-text-muted">{[r.city, r.country].filter(Boolean).join(", ") || "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-text-faint">{formatRelativeTime(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {summary.recent.length === 0 && <p className="py-3 text-sm text-text-faint">No events yet</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
