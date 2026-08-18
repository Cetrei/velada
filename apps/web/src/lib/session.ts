import type { AstroCookies, APIContext } from "astro";
import { createSupabaseAdminClient } from "./supabaseServer";

export interface AppSession {
  userId: string;
  email: string;
  isAdmin: boolean;
  passphraseVerified: boolean;
}

const SESSION_COOKIE = "velada_session";
const PASSPHRASE_COOKIE = "velada_panel_unlocked";
const SESSION_TTL_DAYS = 30;

function adminEmails(context: Pick<APIContext, "locals">): Set<string> {
  const raw = (context.locals as { runtime?: { env?: Record<string, unknown> } } | undefined)
    ?.runtime?.env?.ADMIN_EMAILS as string | undefined;
  const fallback = import.meta.env.ADMIN_EMAILS as string | undefined;
  const value = raw ?? fallback ?? "";
  return new Set(
    value
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Creates a session row + cookie for a given user. Called right after a
 * successful login/register/admin-login. Session ids are random UUIDs
 * (via crypto.randomUUID, available in both Workers and astro dev) stored
 * server-side in `sessions` — the cookie only carries the opaque id, never
 * anything the client could forge into a valid session by itself.
 */
export async function createSession(
  cookies: AstroCookies,
  locals: Pick<APIContext, "locals">["locals"],
  userId: string
): Promise<string | null> {
  const [admin, msg] = createSupabaseAdminClient(locals);
  if (!admin) {
    console.warn("No se pudo crear el cliente de Supabase admin:", msg);
    return null;
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await admin.from("sessions").insert({ id: sessionId, user_id: userId, expires_at: expiresAt });
  if (error) {
    console.warn("No se pudo crear la sesion:", error.message);
    return null;
  }

  cookies.set(SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60
  });

  return sessionId;
}

export async function destroySession(
  cookies: AstroCookies,
  locals: Pick<APIContext, "locals">["locals"]
): Promise<void> {
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  cookies.delete(SESSION_COOKIE, { path: "/" });
  cookies.delete(PASSPHRASE_COOKIE, { path: "/" });

  if (!sessionId) return;

  const [admin] = createSupabaseAdminClient(locals);
  if (!admin) return;

  await admin.from("sessions").delete().eq("id", sessionId);
}

/**
 * Resolves the current session by looking up the cookie's session id in
 * the `sessions` table (joined to `participant_users` for email). Returns
 * null for no cookie, an unknown/expired session id, or infra failure —
 * callers treat null as "not logged in".
 *
 * isAdmin is derived from ADMIN_EMAILS (env), not stored on the user row:
 * an admin is just a participant_users row whose email happens to be
 * listed, so the same login covers both /inscripcion and the panel.
 * passphraseVerified is a separate short-lived cookie set after
 * verifyPassphrase, same as before.
 */
export async function getSession(
  cookies: AstroCookies,
  context: Pick<APIContext, "locals">
): Promise<AppSession | null> {
  const sessionId = cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const [admin, msg] = createSupabaseAdminClient(context.locals);
  if (!admin) {
    console.warn("No se pudo crear el cliente de Supabase admin:", msg);
    return null;
  }

  const { data, error } = await admin
    .from("sessions")
    .select("user_id, expires_at, participant_users(email)")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  const userRow = data.participant_users as unknown as { email: string } | null;
  if (!userRow?.email) return null;

  const emails = adminEmails(context);
  const passphraseVerified = cookies.get(PASSPHRASE_COOKIE)?.value === "true";

  return {
    userId: data.user_id,
    email: userRow.email,
    isAdmin: emails.has(userRow.email.toLowerCase()),
    passphraseVerified
  };
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

export function isAdminEmail(context: Pick<APIContext, "locals">, email: string): boolean {
  return adminEmails(context).has(email.trim().toLowerCase());
}
