import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Lazily creates a singleton Supabase client. Returns null when env vars are
 * missing so pages can render in a read-only/static fallback mode instead of
 * crashing (useful for local dev before `bun run setup:supabase` has run).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;

  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.warn("Supabase env vars missing, realtime features are disabled.");
    return null;
  }

  client = createClient(url, anonKey);
  return client;
}

export const ROULETTE_CHANNEL = "roulette_room";
export const SPIN_START_EVENT = "SPIN_START";
export const SPIN_RESULT_EVENT = "SPIN_RESULT";
