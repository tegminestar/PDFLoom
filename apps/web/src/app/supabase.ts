import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Auth/billing are opt-in infrastructure — the free/local product must
 * keep working with zero configuration, so a missing Supabase project is a
 * real, expected state (this sandbox has none configured), not an error.
 * Every call site checks this before touching `supabase`.
 */
export const isAuthConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isAuthConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
