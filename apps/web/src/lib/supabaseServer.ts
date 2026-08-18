import { createClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { getServerEnv } from "./env";

/**
 * Service-role client that bypasses RLS. This is now the ONLY server-side
 * Supabase client in the app — auth moved off Supabase Auth entirely (own
 * `participant_users` + `sessions` tables, see lib/session.ts +
 * lib/password.ts), so every read/write that used to rely on RLS +
 * auth.uid() now goes through this client with permission checks done by
 * hand in the caller (see requireOwnParticipant/requireAdmin-style guards
 * in actions/index.ts).
 *
 * Never import this in client components — it would leak the secret key
 * to the browser bundle.
 *
 * Needs the request context (specifically `locals`) to read
 * SUPABASE_SERVICE_ROLE_KEY correctly in production — see getServerEnv's
 * comment in ./env.ts for why import.meta.env alone doesn't see Cloudflare
 * Worker secrets at runtime.
 */
export function createSupabaseAdminClient(
  locals?: Pick<APIContext, "locals">["locals"]
): [ReturnType<typeof createClient> | null, string] {
  const ctx = { locals: locals ?? {} } as Pick<APIContext, "locals">;
  const url = getServerEnv(ctx, "PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getServerEnv(ctx, "SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) return [null, "Supabase URL or service role key not set in environment variables."];

  return [createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  }), "Supabase admin client created successfully."];
}
