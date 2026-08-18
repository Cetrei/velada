import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";

/**
 * SSR-aware Supabase client bound to the request's cookies. Use this in
 * .astro pages and Astro Actions for anything auth-related (login, session
 * checks) so the session cookie round-trips correctly.
 */
export function createSupabaseServerClient(request: Request, cookies: AstroCookies): [ReturnType<typeof createServerClient>|null, string] {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

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
 */
export function createSupabaseAdminClient(): [ReturnType<typeof createClient>|null, string] {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) return [null, "Supabase URL or service role key not set in environment variables."];

  return [createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: true, persistSession: true }
  }), "Supabase admin client created successfully."];
}
