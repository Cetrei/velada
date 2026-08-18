import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";

/**
 * SSR-aware Supabase client bound to the request's cookies. Use this in
 * .astro pages and Astro Actions for anything auth-related (login, session
 * checks) so the session cookie round-trips correctly.
 */
export function createSupabaseServerClient(request: Request, cookies: AstroCookies) {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get("Cookie") ?? "");
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookies.set(name, value, options));
      }
    }
  });
}

/**
 * Service-role client that bypasses RLS. Only for server-side use (Astro
 * Actions, scripts) — never import this in client components, it would leak
 * the secret key to the browser bundle.
 */
export function createSupabaseAdminClient() {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
