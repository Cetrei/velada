import type { AstroCookies } from "astro";
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
 */
export async function getPanelSession(
  request: Request,
  cookies: AstroCookies
): Promise<PanelSession | null> {
  const supabase = createSupabaseServerClient(request, cookies);
  if (!supabase) return null;

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
