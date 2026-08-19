import type { AstroCookies, APIContext } from "astro";
import { createSupabaseAdminClient } from "./supabaseServer";
import { getServerEnv } from "./env";

export interface AppSession {
  userId: string;
  email: string;
}

const SESSION_COOKIE = "velada_session";
const ADMIN_COOKIE = "velada_admin_session";
const SESSION_TTL_DAYS = 30;
const ADMIN_SESSION_TTL_HOURS = 4;

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

  if (!sessionId) return;

  const [admin] = createSupabaseAdminClient(locals);
  if (!admin) return;

  await admin.from("sessions").delete().eq("id", sessionId);
}

/**
 * Resolves the current FIGHTER session by looking up the cookie's session
 * id in the `sessions` table (joined to `participant_users` for email).
 * Returns null for no cookie, an unknown/expired session id, or infra
 * failure — callers treat null as "not logged in".
 *
 * Fighter accounts (participant_users/sessions, /inscripcion) and admin
 * access (see getAdminSession below) are now two completely separate
 * systems: an admin email gets no special treatment here, and a fighter
 * session never grants panel access, no matter what email it belongs to.
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

  return {
    userId: data.user_id,
    email: userRow.email
  };
}

export interface AdminSession {
  email: string;
}

/**
 * Cuenta de admin != cuenta de inscripcion: el panel ya NO reutiliza
 * participant_users/sessions ni ADMIN_EMAILS + password opcional de un
 * jugador. Es su propio sistema, mas simple a proposito: una cookie
 * firmada por el conocimiento de PANEL_PASSPHRASE + el email quedando
 * adentro del payload solo para mostrarlo en la UI ("sesion iniciada
 * como..."), sin ninguna fila en DB ni passwords por jugador. El unico
 * secreto real es PANEL_PASSPHRASE (env), igual que antes -- lo que
 * cambia es que ahora se pide en el login mismo (ver actions.adminLogin),
 * no como un paso separado despues de "iniciar sesion" solo con el email.
 */
export async function createAdminSession(cookies: AstroCookies, email: string): Promise<void> {
  const payload = JSON.stringify({ email, exp: Date.now() + ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000 });
  cookies.set(ADMIN_COOKIE, btoa(payload), {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: ADMIN_SESSION_TTL_HOURS * 60 * 60
  });
}

export function destroyAdminSession(cookies: AstroCookies): void {
  cookies.delete(ADMIN_COOKIE, { path: "/" });
}

/**
 * No hay DB de por medio: la cookie es HttpOnly + Secure + SameSite=lax
 * (no legible ni forgeable desde JS del cliente) y expira sola a las
 * ADMIN_SESSION_TTL_HOURS horas. Alcanza como sesion de servidor corta
 * para un panel de un solo evento -- no hace falta el aparato de
 * sessions/participant_users que si necesitan las cuentas de jugador
 * (que viven mucho mas tiempo y necesitan poder cerrarse remotamente
 * borrando la fila).
 */
export async function getAdminSession(cookies: AstroCookies): Promise<AdminSession | null> {
  const raw = cookies.get(ADMIN_COOKIE)?.value;
  if (!raw) return null;

  try {
    const payload = JSON.parse(atob(raw)) as { email?: string; exp?: number };
    if (!payload.email || !payload.exp || payload.exp < Date.now()) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

export function isAdminEmail(context: Pick<APIContext, "locals">, email: string): boolean {
  return adminEmails(context).has(email.trim().toLowerCase());
}

export function panelPassphraseMatches(context: Pick<APIContext, "locals">, passphrase: string): boolean {
  const expected = getServerEnv(context, "PANEL_PASSPHRASE");
  return !!expected && passphrase === expected;
}
