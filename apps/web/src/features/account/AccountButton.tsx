import { IconButton, useTheme } from "@pdfloom/ui";
import { LogIn, Moon, Sparkles, Sun, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useLoomStore } from "../../app/store";
import { isAuthConfigured } from "../../app/supabase";
import { useAuthStore } from "../../app/auth";
import { AccountDialog } from "./AccountDialog";

/**
 * Floating, always-present (regardless of document state) for the account
 * part, so sign-in never requires a PDF to be open. The theme toggle here
 * only renders while no document is loaded — the in-document Toolbar's own
 * theme button (Sun/Moon, same label) previously had no equivalent before a
 * document was open, which meant no way to switch themes from the welcome
 * screen or while browsing recents. Rendering both at once instead of
 * hand-off (tried first) put two identically-labeled buttons on screen
 * simultaneously once a document was open — harmless to look at, but a real
 * regression caught by viewer.spec.ts's own `getByLabel` theme-toggle test
 * (a Playwright strict-mode violation: two elements, one label). One
 * control at a time, handed off at the same `meta` boundary everything else
 * in App.tsx already uses, avoids that ambiguity entirely.
 */
export function AccountButton() {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const isPro = useAuthStore((s) => s.isPro);
  const meta = useLoomStore((s) => s.meta);
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (isAuthConfigured) initialize();
  }, [initialize]);

  return (
    <>
      {/* top-16, not top-3: every in-document toolbar (Toolbar, SignToolbar,
          RedactToolbar, etc.) is a normal-flow h-14 header claiming the same
          top-right corner for its own rightmost button (Close document, Exit
          sign mode, ...) — at top-3 this floating cluster's high z-index sat
          on top of and silently ate those clicks. Sitting just below the
          toolbar row instead avoids the collision in every mode, not just
          the welcome screen where the conflict wasn't obvious. */}
      <div className="fixed right-3 top-16 z-[150] flex items-center gap-2">
        {!meta && (
          <IconButton
            icon={theme === "dark" ? <Sun /> : <Moon />}
            label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggleTheme}
            className="border border-border-strong bg-surface shadow-(--shadow-floating)"
          />
        )}
        {isAuthConfigured &&
          (user ? (
            // Same "blends into a mostly-dark-neutral UI" problem the
            // signed-out button had — IconButton's default/ai variants
            // carry no resting background at all, only on hover, which is
            // right for an ordinary toolbar icon but not for the one
            // persistent entry point back into the account. A resting chip
            // (not the signed-out button's full solid-accent treatment —
            // this isn't a conversion CTA once already signed in) is
            // enough to read as a real element instead of empty chrome.
            <IconButton
              icon={isPro ? <Sparkles /> : <User />}
              label={isPro ? "Account (Pro)" : "Account"}
              variant={isPro ? "ai" : "default"}
              onClick={() => setOpen(true)}
              className={
                isPro
                  ? "border border-ai/40 bg-ai-muted shadow-(--shadow-floating)"
                  : "border border-border-strong bg-surface shadow-(--shadow-floating)"
              }
            />
          ) : (
            // Signed out is exactly when this needs to be found, not just
            // recognized once you already know it's there. A neutral
            // bordered/bg-surface button (the first fix for this) was still
            // reported as "super small, easy to miss" — it read as more
            // chrome, not a thing to click, against a UI that's mostly dark
            // neutral surfaces already. The solid primary-accent treatment
            // used for actual calls to action elsewhere (Upgrade to Pro,
            // dialog confirm buttons) is the one color in this palette that
            // reads as "click me" rather than "layout element."
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 rounded-(--radius-md) bg-primary px-3.5 py-2 text-sm font-semibold text-primary-text shadow-(--shadow-floating) transition-colors hover:bg-primary-hover active:bg-primary-active"
            >
              <LogIn className="h-4 w-4" />
              Sign in
            </button>
          ))}
      </div>
      {isAuthConfigured && <AccountDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
