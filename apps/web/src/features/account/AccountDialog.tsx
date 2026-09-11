import { Button, Dialog, toast } from "@pdfloom/ui";
import { BarChart3, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl, supabase } from "../../app/supabase";
import { useAuthStore } from "../../app/auth";

export function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const user = useAuthStore((s) => s.user);
  const isPro = useAuthStore((s) => s.isPro);
  const actionPending = useAuthStore((s) => s.actionPending);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signOut = useAuthStore((s) => s.signOut);
  const startCheckout = useAuthStore((s) => s.startCheckout);
  const openBillingPortal = useAuthStore((s) => s.openBillingPortal);

  const [email, setEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [plan, setPlan] = useState<"monthly" | "annual">("monthly");

  // Never checks the signed-in email against anything client-side — the
  // owner's address (ANALYTICS_OWNER_EMAIL) stays server-only, same as
  // feedback.ts's recipient address, so it never appears in the bundle.
  useEffect(() => {
    if (!user || !supabase) {
      setIsOwner(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      const accessToken = data.session?.access_token;
      if (!accessToken) return;
      try {
        const res = await fetch(`${apiUrl}/api/analytics/is-owner`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const body = (await res.json()) as { isOwner?: boolean };
        if (!cancelled) setIsOwner(body.isOwner === true);
      } catch {
        // Leave isOwner false — the menu item just doesn't show.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSignIn = async () => {
    if (!email.trim()) return;
    const { error } = await signInWithEmail(email.trim());
    if (error) toast.error("Couldn't send sign-in link", error);
    else setMagicLinkSent(true);
  };

  const handleUpgrade = async () => {
    const { error } = await startCheckout(plan);
    if (error) toast.error("Couldn't start checkout", error);
  };

  const handleManageBilling = async () => {
    const { error } = await openBillingPortal();
    if (error) toast.error("Couldn't open billing portal", error);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Account"
      description={user ? undefined : "Sign in to manage a PDFLoom Pro subscription. The editor itself never requires an account."}
      width={400}
    >
      {!user ? (
        magicLinkSent ? (
          <p className="text-sm text-text-muted">
            Check <span className="font-medium text-text">{email}</span> for a sign-in link.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm text-text">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSignIn()}
                placeholder="you@example.com"
                className="h-9 rounded-(--radius-sm) border border-border-strong bg-surface px-2.5 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-(--color-focus-ring)"
              />
            </label>
            <Button variant="primary" size="sm" disabled={!email.trim() || actionPending} onClick={() => void handleSignIn()}>
              {actionPending ? "Sending…" : "Send sign-in link"}
            </Button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-(--radius-md) border border-border bg-surface px-3 py-2.5">
            <span className="truncate text-sm text-text">{user.email}</span>
            <span
              className={
                isPro
                  ? "flex items-center gap-1 rounded-full bg-ai-muted px-2 py-0.5 text-xs font-semibold text-ai"
                  : "rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-faint"
              }
            >
              {isPro && <Sparkles className="h-3 w-3" />}
              {isPro ? "Pro" : "Free"}
            </span>
          </div>

          {isOwner && (
            <Button asChild variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              <Link to="/analytics">
                <BarChart3 className="h-4 w-4" />
                Analytics
              </Link>
            </Button>
          )}

          {isPro ? (
            <Button variant="secondary" size="sm" disabled={actionPending} onClick={() => void handleManageBilling()}>
              {actionPending ? "Opening…" : "Manage subscription"}
            </Button>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-2 gap-1.5 rounded-(--radius-md) border border-border bg-surface p-1">
                <button
                  type="button"
                  onClick={() => setPlan("monthly")}
                  className={
                    plan === "monthly"
                      ? "rounded-(--radius-sm) bg-bg-elevated px-2 py-1.5 text-sm font-semibold text-text shadow-sm"
                      : "rounded-(--radius-sm) px-2 py-1.5 text-sm font-medium text-text-muted hover:text-text"
                  }
                >
                  Monthly
                  <span className="block text-xs font-normal text-text-faint">$9/mo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPlan("annual")}
                  className={
                    plan === "annual"
                      ? "rounded-(--radius-sm) bg-bg-elevated px-2 py-1.5 text-sm font-semibold text-text shadow-sm"
                      : "rounded-(--radius-sm) px-2 py-1.5 text-sm font-medium text-text-muted hover:text-text"
                  }
                >
                  Annual
                  <span className="block text-xs font-normal text-text-faint">$100/yr · save $8</span>
                </button>
              </div>
              <Button variant="ai" size="sm" disabled={actionPending} onClick={() => void handleUpgrade()}>
                <Sparkles className="h-4 w-4" />
                {actionPending ? "Starting checkout…" : "Upgrade to Pro"}
              </Button>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      )}
    </Dialog>
  );
}
