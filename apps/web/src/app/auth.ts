import type { User } from "@supabase/supabase-js";
import { create } from "zustand";
import { apiUrl, isAuthConfigured, supabase } from "./supabase";

/**
 * A separate store from useLoomStore on purpose: auth/billing is orthogonal
 * to document-editing state (a whole separate concern, per the plan's
 * core/shell boundary — this is app-shell-only, packages/core has no idea
 * accounts exist). Kept out of the free/local product's critical path:
 * every field here degrades to "signed out, free" when Supabase isn't
 * configured, which is the default and fully-supported state.
 */
interface AuthState {
  user: User | null;
  isPro: boolean;
  loading: boolean;
  /** Set only around the sign-in/checkout/portal network calls, not the whole app. */
  actionPending: boolean;
  initialize: () => void;
  signInWithEmail: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  startCheckout: () => Promise<{ error: string | null }>;
  openBillingPortal: () => Promise<{ error: string | null }>;
}

async function callApi(path: string): Promise<{ url?: string; error?: string }> {
  if (!supabase) return { error: "Auth isn't configured" };
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return { error: "Not signed in" };
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json()) as { url?: string; error?: string };
    if (!res.ok) return { error: body.error ?? `Request failed (${res.status})` };
    return body;
  } catch {
    return { error: "Couldn't reach the billing service" };
  }
}

async function fetchIsPro(userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.from("profiles").select("is_pro").eq("id", userId).single();
  return data?.is_pro === true;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isPro: false,
  loading: isAuthConfigured,
  actionPending: false,

  initialize: () => {
    if (!supabase) {
      set({ loading: false });
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user ?? null;
      const isPro = user ? await fetchIsPro(user.id) : false;
      set({ user, isPro, loading: false });
    });
    supabase.auth.onAuthStateChange(async (_event, session) => {
      const user = session?.user ?? null;
      const isPro = user ? await fetchIsPro(user.id) : false;
      set({ user, isPro, loading: false });
    });
  },

  signInWithEmail: async (email) => {
    if (!supabase) return { error: "Auth isn't configured" };
    set({ actionPending: true });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/app" },
    });
    set({ actionPending: false });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ user: null, isPro: false });
  },

  startCheckout: async () => {
    set({ actionPending: true });
    const result = await callApi("/api/checkout");
    set({ actionPending: false });
    if (result.url) window.location.href = result.url;
    return { error: result.error ?? null };
  },

  openBillingPortal: async () => {
    set({ actionPending: true });
    const result = await callApi("/api/billing-portal");
    set({ actionPending: false });
    if (result.url) window.location.href = result.url;
    return { error: result.error ?? null };
  },
}));
