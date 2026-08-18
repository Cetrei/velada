import type { AstroCookies, APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabaseServer";

export interface PanelSession {
  userId: string;
  email: string;
  passphraseVerified: boolean;
}

const PASSPHRASE_COOKIE = "velada_panel_unlocked";

/**
 * Resolves the current panel session: checks Supabase Auth login, then
 * whether the user's id is in the admins table, then whether they've
 * already passed the passphrase gate this session (short-lived cookie set
 * by the verifyPassphrase action after a successful check).
 * Returns null if any step fails, callers should redirect to /panel-login.
 *
 * Accepts an already-authenticated Supabase client via `existingClient`
 * instead of always creating a fresh one. This matters right after
 * supabase.auth.setSession() (magic link login): a freshly created client
 * reads cookies from the *incoming* request headers via @supabase/ssr,
 * which don't include the session cookies setSession() just wrote (those
 * only exist in the outgoing response, added to `cookies` for this same
 * request) - so a new client's getUser() fails with "Auth session missing"
 * even though the session was just established successfully. Passing the
 * client that called setSession() keeps using its in-memory session
 * instead of re-deriving one from cookies that aren't there yet.
 */
export async function getPanelSession(
  request: Request,
  cookies: AstroCookies,
  existingClient?: SupabaseClient,
  locals?: Pick<APIContext, "locals">["locals"]
): Promise<PanelSession | null> {
  let supabase = existingClient;
  if (!supabase) {
    const [freshClient, msg] = createSupabaseServerClient(request, cookies, locals);
    if (!freshClient) {
      console.warn("No se pudo crear el cliente de Supabase:", msg);
      return null;
    }
    supabase = freshClient;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !user.email) return null;

  const { data: adminRow } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!adminRow) return null;

  const passphraseVerified = cookies.get(PASSPHRASE_COOKIE)?.value === "true";

  return { userId: user.id, email: user.email, passphraseVerified };
}

export function markPassphraseVerified(cookies: AstroCookies): void {
  cookies.set(PASSPHRASE_COOKIE, "true", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4
  });
}
