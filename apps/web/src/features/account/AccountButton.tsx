import { IconButton } from "@pdfloom/ui";
import { Sparkles, User } from "lucide-react";
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
      <div className="fixed right-3 top-3 z-[150]">
        <IconButton
          icon={isPro ? <Sparkles /> : <User />}
          label={user ? (isPro ? "Account (Pro)" : "Account") : "Sign in"}
          variant={isPro ? "ai" : "default"}
          onClick={() => setOpen(true)}
        />
      </div>
      <AccountDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
