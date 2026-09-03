import { IconButton } from "@pdfloom/ui";
import { LogIn, Sparkles, User } from "lucide-react";
import { useEffect, useState } from "react";
import { isAuthConfigured } from "../../app/supabase";
import { useAuthStore } from "../../app/auth";
import { AccountDialog } from "./AccountDialog";

/**
 * Floating, always-present (regardless of document state) so sign-in never
 * requires a PDF to be open. Renders nothing at all when no Supabase
 * project is configured — auth is opt-in infrastructure, not a
 * requirement of the free/local product, so there's no broken "Sign in"
 * button to trip over when it's simply not set up yet.
 */
export function AccountButton() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const isPro = useAuthStore((s) => s.isPro);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isAuthConfigured) initialize();
  }, [initialize]);

  if (!isAuthConfigured) return null;

  return (
    <>
      {/* top-16, not top-3: every in-document toolbar (Toolbar, SignToolbar,
          RedactToolbar, etc.) is a normal-flow h-14 header claiming the same
          top-right corner for its own rightmost button (Close document, Exit
          sign mode, ...) — at top-3 this floating button's high z-index sat
          on top of and silently ate those clicks. Sitting just below the
          toolbar row instead avoids the collision in every mode, not just
          the welcome screen where the conflict wasn't obvious. */}
      <div className="fixed right-3 top-16 z-[150]">
        {user ? (
          <IconButton
            icon={isPro ? <Sparkles /> : <User />}
            label={isPro ? "Account (Pro)" : "Account"}
            variant={isPro ? "ai" : "default"}
            onClick={() => setOpen(true)}
          />
        ) : (
          // Signed out is exactly when this needs to be found, not just
          // recognized once you already know it's there — an icon-only
          // button with no resting background (IconButton's "default"
          // variant) blended into the page and was easy to miss entirely.
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-[--radius-md] border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-text shadow-[--shadow-floating] transition-colors hover:bg-surface-hover"
          >
            <LogIn className="h-4 w-4" />
            Sign in
          </button>
        )}
      </div>
      <AccountDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
