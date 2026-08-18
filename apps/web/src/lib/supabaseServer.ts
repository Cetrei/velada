import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { AstroCookies, APIContext } from "astro";
import { getServerEnv } from "./env";

/**
 * SSR-aware Supabase client bound to the request's cookies. Use this in
 * .astro pages and Astro Actions for anything auth-related (login, session
 * checks) so the session cookie round-trips correctly.
 *
 * url/anonKey are read via getServerEnv even though PUBLIC_* vars are
 * normally build-time-inlined and would work fine off import.meta.env
 * alone — passing locals here costs nothing and keeps this consistent with
 * createSupabaseAdminClient below, so a future non-PUBLIC_ var swapped in
 * here doesn't silently break the same way SUPABASE_SERVICE_ROLE_KEY did.
 */
export function createSupabaseServerClient(
  request: Request,
  cookies: AstroCookies,
  locals?: Pick<APIContext, "locals">["locals"]
): [ReturnType<typeof createServerClient> | null, string] {
  const ctx = { locals: locals ?? {} } as Pick<APIContext, "locals">;
  const url = getServerEnv(ctx, "PUBLIC_SUPABASE_URL");
  const anonKey = getServerEnv(ctx, "PUBLIC_SUPABASE_ANON_KEY");

  if (!url || !anonKey) return [null, "Supabase URL or anon key not set in environment variables."];

  return [createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "");
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookies.set(name, value, options));
        } catch (error) {
          console.error("Error setting cookies:", error);
        }
      }
    }
  }), "Supabase client created successfully."];
}

/**
 * Service-role client that bypasses RLS. Only for server-side use (Astro
 * Actions, scripts) — never import this in client components, it would leak
 * the secret key to the browser bundle.
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
    auth: { autoRefreshToken: true, persistSession: true }
  }), "Supabase admin client created successfully."];
}

