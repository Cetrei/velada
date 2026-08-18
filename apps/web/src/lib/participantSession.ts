import type { AstroCookies } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabaseServer";

export interface ParticipantSession {
  userId: string;
  email: string;
}

/**
 * Resolves the current self-registered participant session: just requires a
 * logged-in Supabase Auth user, no admins/passphrase gate (that's
 * getPanelSession, for the separate admin login). Used by /inscripcion so
 * any registered fighter can create/edit their own profile.
 *
 * Same existingClient parameter and rationale as getPanelSession: right
 * after signUp()/signInWithPassword() in the same request, a freshly
 * created client can't see cookies that only exist in the outgoing
 * response yet.
 */
export async function getParticipantSession(
  request: Request,
  cookies: AstroCookies,
  existingClient?: SupabaseClient
): Promise<ParticipantSession | null> {
  if (!existingClient) {
    console.warn("Cliente Supabase inexistente");
    return null;
  }
  const [supabase, msg] = createSupabaseServerClient(request, cookies);
  if (!supabase) {
    console.warn("No se pudo crear el cliente de Supabase:", msg);
    return null;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !user.email) return null;

  return { userId: user.id, email: user.email };
}
