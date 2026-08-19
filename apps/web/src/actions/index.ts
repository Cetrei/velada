import { defineAction, ActionError } from "astro:actions";
import { z } from "astro:schema";
import { createSupabaseAdminClient } from "../lib/supabaseServer";
import { getSession, createSession, destroySession, markPassphraseVerified, isAdminEmail } from "../lib/session";
import { hashPassword, verifyPassword } from "../lib/password";
import { getServerEnv } from "../lib/env";
import { fetchEventState } from "../lib/eventState";
import {
  ParticipantStatsSchema,
  isPasswordValid,
  PASSWORD_MIN_LENGTH,
  fetchRankFromLeagueOfGraphs,
  RankLookupError,
  RANK_SOURCE_SERVERS
} from "@velada/core";
import type { AppSession } from "../lib/session";

function requireSession(session: AppSession | null): AppSession {
  if (!session) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "No autenticado." });
  }
  return session;
}

/**
 * Panel auth = logged in + email listed in ADMIN_EMAILS + passphrase gate
 * already passed this session. Replaces the old getPanelSession +
 * `admins` table lookup: admin-ness is now derived purely from
 * ADMIN_EMAILS (env), not a DB row, since there's no Supabase Auth user id
 * to key a table on anymore.
 */
function requirePanelAuth(session: AppSession | null): AppSession {
  const s = requireSession(session);
  if (!s.isAdmin) {
    throw new ActionError({ code: "FORBIDDEN", message: "Tu cuenta no tiene acceso al panel." });
  }
  if (!s.passphraseVerified) {
    throw new ActionError({ code: "FORBIDDEN", message: "Falta verificar la clave del panel." });
  }
  return s;
}

/**
 * Mensajes de error pensados para el jugador que llena el formulario, sin
 * mencionar de donde viene el dato ni como se obtiene (nada de "scraping",
 * "HTML", "Riot API", nombres de sitios de terceros, etc.) — solo lo que
 * puede hacer al respecto.
 */
function rankLookupErrorMessage(reason: RankLookupError["reason"]): string {
  switch (reason) {
    case "not_found":
      return "No encontramos ese Riot ID en ese servidor. Revisa que este bien escrito.";
    case "invalid_riot_id":
      return 'Formato invalido. Usa "NombreDeInvocador#TAG" (Riot ID).';
    case "invalid_server":
      return `Servidor no reconocido. Usa: ${Object.keys(RANK_SOURCE_SERVERS).join(", ")}.`;
    case "source_unavailable":
      return "No pudimos consultar tu rango ahora mismo. Se reintentara al guardar.";
    case "unexpected_format":
      return "No pudimos leer tu rango ahora mismo. Se reintentara al guardar.";
    default:
      return "No pudimos consultar tu rango ahora mismo. Se reintentara al guardar.";
  }
}

function actionErrorCodeForRankLookup(reason: RankLookupError["reason"]): "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR" {
  switch (reason) {
    case "not_found":
      return "NOT_FOUND";
    case "invalid_riot_id":
    case "invalid_server":
      return "BAD_REQUEST";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}

/**
 * Looks up a player's current rank. Shared by the admin lookupRank action
 * (manual "Consultar" button) and saveOwnParticipant (self-service profile
 * save, where the rank is always re-derived server-side so nobody can type
 * in "Challenger" by hand). Consulta un sitio externo de estadisticas de
 * LoL (ver packages/core/rankScraper.ts para el detalle tecnico y por que
 * se eligio esa fuente) — no la Riot API directamente.
 */
async function fetchRiotRank(lolUsername: string, lolServer: string): Promise<{ rank: string; lp: number }> {
  try {
    const result = await fetchRankFromLeagueOfGraphs(lolUsername, lolServer);
    if (!result) {
      return { rank: "Sin clasificar", lp: 0 };
    }
    return { rank: result.rank, lp: result.leaguePoints };
  } catch (err) {
    if (err instanceof RankLookupError) {
      throw new ActionError({
        code: actionErrorCodeForRankLookup(err.reason),
        message: rankLookupErrorMessage(err.reason)
      });
    }
    throw new ActionError({
      code: "INTERNAL_SERVER_ERROR",
      message: rankLookupErrorMessage("source_unavailable")
    });
  }
}

const ownParticipantFields = {
  name: z.string().min(1),
  nickname: z.string().min(1),
  age: z.coerce.number().int().positive().optional(),
  weight: z.string().optional(),
  height: z.string().optional(),
  country: z.string().optional(),
  countryFlag: z.string().optional(),
  instagramHandle: z.string().optional(),
  instagramFollowers: z.string().optional(),
  xHandle: z.string().optional(),
  xFollowers: z.string().optional(),
  lolUsername: z.string().min(1),
  lolServer: z.string().min(1),
  mainRole: z.enum(["Top", "Jungle", "Mid", "ADC", "Support"]),
  favChampion: z.string().min(1),
  description: z.string().optional(),
  stats: z.string().optional(),
  photo: z.instanceof(File).optional(),
  banner: z.instanceof(File).optional()
};

export const server = {
  /**
   * Unified login for BOTH fighters and admins. Admin emails (ADMIN_EMAILS
   * env) skip the password check entirely — they authenticate with just
   * their email, then still have to clear the separate PANEL_PASSPHRASE
   * gate (verifyPassphrase) before actually reaching the panel. A row in
   * `participant_users` is created on the fly for a first-time admin login
   * (no self-registration flow needed for them, unlike fighters).
   */
  login: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email(),
      password: z.string().min(6).optional()
    }),
    handler: async ({ email, password }, context) => {
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const admitAsAdmin = isAdminEmail(context, normalizedEmail);

      const { data: existing } = await admin
        .from("participant_users")
        .select("id, password_hash")
        .eq("email", normalizedEmail)
        .maybeSingle();

      let userId: string;

      if (admitAsAdmin) {
        // Admins never need a password of their own; if they don't have a
        // row yet (first login), create one with a random unusable hash so
        // the column stays NOT NULL without granting a real password.
        if (existing) {
          userId = existing.id;
        } else {
          const placeholderHash = await hashPassword(crypto.randomUUID());
          const { data: created, error } = await admin
            .from("participant_users")
            .insert({ email: normalizedEmail, password_hash: placeholderHash })
            .select("id")
            .single();
          if (error || !created) {
            throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error?.message ?? "No se pudo crear la cuenta." });
          }
          userId = created.id;
        }
      } else {
        if (!existing) {
          throw new ActionError({ code: "UNAUTHORIZED", message: "Credenciales invalidas." });
        }
        if (!password) {
          throw new ActionError({ code: "BAD_REQUEST", message: "Falta la contrasena." });
        }
        const valid = await verifyPassword(password, existing.password_hash);
        if (!valid) {
          throw new ActionError({ code: "UNAUTHORIZED", message: "Credenciales invalidas." });
        }
        userId = existing.id;
      }

      const sessionId = await createSession(context.cookies, context.locals, userId);
      if (!sessionId) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la sesion." });
      }

      return { success: true, isAdmin: admitAsAdmin };
    }
  }),

  logout: defineAction({
    handler: async (_input, context) => {
      await destroySession(context.cookies, context.locals);
      return { success: true };
    }
  }),

  verifyPassphrase: defineAction({
    accept: "form",
    input: z.object({ passphrase: z.string().min(1) }),
    handler: async ({ passphrase }, context) => {
      const session = requireSession(await getSession(context.cookies, context));
      if (!session.isAdmin) {
        throw new ActionError({ code: "FORBIDDEN", message: "Tu cuenta no tiene acceso al panel." });
      }

      const expected = getServerEnv(context, "PANEL_PASSPHRASE");
      if (!expected) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "PANEL_PASSPHRASE no configurada en el servidor." });
      }

      if (passphrase !== expected) {
        throw new ActionError({ code: "FORBIDDEN", message: "Clave incorrecta." });
      }

      markPassphraseVerified(context.cookies);
      return { success: true };
    }
  }),

  /**
   * Step 1 of the unified email-first auth flow on /inscripcion: given just
   * an email, tells the client whether an account already exists so the UI
   * can ask for "tu contrasena" (login) vs "crea una contrasena" (register)
   * without a separate tabs/toggle the user has to pick themselves.
   * Also flags isAdmin (ADMIN_EMAILS) so AuthGate can skip the
   * password field entirely for host accounts, even on their very first
   * login (before they have a participant_users row at all).
   */
  checkEmailExists: defineAction({
    accept: "form",
    input: z.object({ email: z.string().email() }),
    handler: async ({ email }, context) => {
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const { data } = await admin
        .from("participant_users")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();

      return { exists: !!data, isAdmin: isAdminEmail(context, normalizedEmail) };
    }
  }),

  /**
   * Self-registration for fighters: creates a row in participant_users
   * with a PBKDF2 password hash, then logs them in immediately (no
   * separate login step) so /inscripcion can go straight from "crea tu
   * contrasena" to the profile form in one submit.
   */
  registerParticipant: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email(),
      password: z.string().min(PASSWORD_MIN_LENGTH)
    }),
    handler: async ({ email, password }, context) => {
      const eventState = await fetchEventState();
      if (!eventState.registrationsOpen) {
        throw new ActionError({ code: "FORBIDDEN", message: "Las inscripciones estan cerradas." });
      }

      // El min(PASSWORD_MIN_LENGTH) de arriba solo cubre el largo; letra +
      // numero se validan aca contra la misma regla que dibuja el checklist
      // en AuthGate.tsx (checkPasswordRules de @velada/core), asi las dos
      // superficies nunca quedan desincronizadas.
      if (!isPasswordValid(password)) {
        throw new ActionError({ code: "BAD_REQUEST", message: "La contrasena no cumple los requisitos minimos." });
      }

      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const normalizedEmail = email.trim().toLowerCase();
      const { data: existing } = await admin
        .from("participant_users")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (existing) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Ese email ya tiene una cuenta." });
      }

      const passwordHash = await hashPassword(password);
      const { data: created, error } = await admin
        .from("participant_users")
        .insert({ email: normalizedEmail, password_hash: passwordHash })
        .select("id")
        .single();

      if (error || !created) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error?.message ?? "No se pudo crear la cuenta." });
      }

      const sessionId = await createSession(context.cookies, context.locals, created.id);
      if (!sessionId) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la sesion." });
      }

      return { success: true };
    }
  }),

  loginParticipant: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email(),
      password: z.string().min(6)
    }),
    handler: async ({ email, password }, context) => {
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { data: existing } = await admin
        .from("participant_users")
        .select("id, password_hash")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();

      if (!existing || !(await verifyPassword(password, existing.password_hash))) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Credenciales invalidas." });
      }

      const sessionId = await createSession(context.cookies, context.locals, existing.id);
      if (!sessionId) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo crear la sesion." });
      }

      return { success: true };
    }
  }),

  logoutParticipant: defineAction({
    handler: async (_input, context) => {
      await destroySession(context.cookies, context.locals);
      return { success: true };
    }
  }),

  /**
   * Creates or updates the caller's own participant profile. The row is
   * matched by owner_user_id (never by a client-supplied id), and lolRank is
   * always re-derived from the Riot API here — the form only ever sends
   * lolUsername + lolServer, never a free-text rank, so nobody can claim
   * Challenger by typing it in.
   */
  saveOwnParticipant: defineAction({
    accept: "form",
    input: z.object(ownParticipantFields),
    handler: async (input, context) => {
      const session = requireSession(await getSession(context.cookies, context));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { rank } = await fetchRiotRank(input.lolUsername, input.lolServer);

      const { data: existing } = await admin
        .from("participants")
        .select("id, photo, banner")
        .eq("owner_user_id", session.userId)
        .maybeSingle();

      const participantId = existing?.id ?? session.userId;

      let photoUrl: string | undefined;
      if (input.photo && input.photo.size > 0) {
        const extension = input.photo.name.split(".").pop() ?? "webp";
        const path = `${participantId}-${Date.now()}.${extension}`;
        const { error: uploadError } = await admin.storage
          .from("participant-photos")
          .upload(path, input.photo, { upsert: true });

        if (uploadError) {
          throw new ActionError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Error subiendo la foto: ${uploadError.message}`
          });
        }

        const { data: publicUrlData } = admin.storage.from("participant-photos").getPublicUrl(path);
        photoUrl = publicUrlData.publicUrl;
      }

      let bannerUrl: string | undefined;
      if (input.banner && input.banner.size > 0) {
        const extension = input.banner.name.split(".").pop() ?? "webp";
        const path = `${participantId}-banner-${Date.now()}.${extension}`;
        const { error: uploadError } = await admin.storage
          .from("participant-photos")
          .upload(path, input.banner, { upsert: true });

        if (uploadError) {
          throw new ActionError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Error subiendo el banner: ${uploadError.message}`
          });
        }

        const { data: publicUrlData } = admin.storage.from("participant-photos").getPublicUrl(path);
        bannerUrl = publicUrlData.publicUrl;
      }

      let parsedStats: unknown;
      if (input.stats) {
        try {
          parsedStats = ParticipantStatsSchema.parse(JSON.parse(input.stats));
        } catch {
          throw new ActionError({ code: "BAD_REQUEST", message: "Stats invalidos." });
        }
      }

      const row = {
        id: participantId,
        owner_user_id: session.userId,
        name: input.name,
        nickname: input.nickname,
        age: input.age ?? null,
        weight: input.weight || null,
        height: input.height || null,
        country: input.country || null,
        country_flag: input.countryFlag || null,
        instagram_handle: input.instagramHandle || null,
        instagram_followers: input.instagramFollowers || null,
        x_handle: input.xHandle || null,
        x_followers: input.xFollowers || null,
        lol_rank: rank,
        lol_username: input.lolUsername,
        lol_server: input.lolServer,
        main_role: input.mainRole,
        fav_champion: input.favChampion,
        description: input.description || null,
        stats: parsedStats ?? null,
        updated_at: new Date().toISOString(),
        ...(photoUrl ? { photo: photoUrl } : {}),
        ...(bannerUrl ? { banner: bannerUrl } : {})
      };

      const { error } = await admin.from("participants").upsert(row, { onConflict: "owner_user_id" });
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      return { success: true, id: participantId, lolRank: rank };
    }
  }),

  saveParticipant: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      nickname: z.string().min(1),
      age: z.coerce.number().int().positive().optional(),
      weight: z.string().optional(),
      height: z.string().optional(),
      country: z.string().optional(),
      countryFlag: z.string().optional(),
      instagramHandle: z.string().optional(),
      instagramFollowers: z.string().optional(),
      xHandle: z.string().optional(),
      xFollowers: z.string().optional(),
      lolRank: z.string().min(1),
      lolUsername: z.string().optional(),
      lolServer: z.string().optional(),
      mainRole: z.enum(["Top", "Jungle", "Mid", "ADC", "Support"]),
      favChampion: z.string().min(1),
      description: z.string().optional(),
      stats: z.string().optional(),
      photo: z.instanceof(File).optional(),
      banner: z.instanceof(File).optional()
    }),
    handler: async (input, context) => {
      requirePanelAuth(await getSession(context.cookies, context));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      let photoUrl: string | undefined;
      if (input.photo && input.photo.size > 0) {
        const extension = input.photo.name.split(".").pop() ?? "webp";
        const path = `${input.id}-${Date.now()}.${extension}`;
        const { error: uploadError } = await admin.storage
          .from("participant-photos")
          .upload(path, input.photo, { upsert: true });

        if (uploadError) {
          throw new ActionError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Error subiendo la foto: ${uploadError.message}`
          });
        }

        const { data: publicUrlData } = admin.storage.from("participant-photos").getPublicUrl(path);
        photoUrl = publicUrlData.publicUrl;
      }

      let bannerUrl: string | undefined;
      if (input.banner && input.banner.size > 0) {
        const extension = input.banner.name.split(".").pop() ?? "webp";
        const path = `${input.id}-banner-${Date.now()}.${extension}`;
        const { error: uploadError } = await admin.storage
          .from("participant-photos")
          .upload(path, input.banner, { upsert: true });

        if (uploadError) {
          throw new ActionError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Error subiendo el banner: ${uploadError.message}`
          });
        }

        const { data: publicUrlData } = admin.storage.from("participant-photos").getPublicUrl(path);
        bannerUrl = publicUrlData.publicUrl;
      }

      let parsedStats: unknown;
      if (input.stats) {
        try {
          parsedStats = ParticipantStatsSchema.parse(JSON.parse(input.stats));
        } catch {
          throw new ActionError({ code: "BAD_REQUEST", message: "Stats invalidos." });
        }
      }

      const row = {
        id: input.id,
        name: input.name,
        nickname: input.nickname,
        age: input.age ?? null,
        weight: input.weight || null,
        height: input.height || null,
        country: input.country || null,
        country_flag: input.countryFlag || null,
        instagram_handle: input.instagramHandle || null,
        instagram_followers: input.instagramFollowers || null,
        x_handle: input.xHandle || null,
        x_followers: input.xFollowers || null,
        lol_rank: input.lolRank,
        lol_username: input.lolUsername || null,
        lol_server: input.lolServer || null,
        main_role: input.mainRole,
        fav_champion: input.favChampion,
        description: input.description || null,
        stats: parsedStats ?? null,
        updated_at: new Date().toISOString(),
        ...(photoUrl ? { photo: photoUrl } : {}),
        ...(bannerUrl ? { banner: bannerUrl } : {})
      };

      const { error } = await admin.from("participants").upsert(row);
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      return { success: true, id: input.id };
    }
  }),

  deleteParticipant: defineAction({
    accept: "form",
    input: z.object({ id: z.string().min(1) }),
    handler: async ({ id }, context) => {
      requirePanelAuth(await getSession(context.cookies, context));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      try {
        const { error, status, statusText, count } = await admin
          .from("participants")
          .delete({ count: "exact" })
          .eq("id", id);

        if (error) {
          const detail = `[deleteParticipant] id=${id} status=${status} statusText=${statusText} code=${error.code ?? "?"} details=${error.details ?? "?"} hint=${error.hint ?? "?"} message=${error.message}`;
          console.log(detail);
          throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: detail });
        }

        if (count === 0) {
          const detail = `[deleteParticipant] id=${id} no matcheo ninguna fila (ya borrado o id incorrecto).`;
          console.log(detail);
          throw new ActionError({ code: "NOT_FOUND", message: detail });
        }

        return { success: true };
      } catch (err) {
        if (err instanceof ActionError) throw err;
        const raw = err instanceof Error ? `${err.name}: ${err.message}` : JSON.stringify(err);
        const detail = `[deleteParticipant] id=${id} excepcion no capturada: ${raw}`;
        console.log(detail);
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: detail });
      }
    }
  }),

  lookupRank: defineAction({
    accept: "form",
    input: z.object({
      lolUsername: z.string().min(1),
      lolServer: z.string().min(1)
    }),
    handler: async ({ lolUsername, lolServer }, context) => {
      requirePanelAuth(await getSession(context.cookies, context));
      return fetchRiotRank(lolUsername, lolServer);
    }
  }),

  /**
   * Live-check for the Riot ID + server as the fighter types it in
   * /inscripcion, driving the green check / yellow spinner / red X
   * indicator next to the field before they submit. Requires a logged-in
   * session (not full panel auth) so it stays usable by fighters
   * self-registering. Never throws for the expected "still typing" or
   * "typo" states (not_found / invalid) — only real infra failures
   * (fuente externa caida/formato inesperado) throw, matching
   * fetchRiotRank's own error semantics.
   */
  checkRiotProfile: defineAction({
    accept: "form",
    input: z.object({
      lolUsername: z.string().min(1),
      lolServer: z.string().min(1)
    }),
    handler: async ({ lolUsername, lolServer }) => {
      const serverKey = lolServer.toUpperCase();
      if (!RANK_SOURCE_SERVERS[serverKey]) {
        return { status: "invalid" as const, reason: "server" as const };
      }
      const [gameName, tagLine] = lolUsername.split("#");
      if (!gameName || !tagLine) {
        return { status: "invalid" as const, reason: "format" as const };
      }

      try {
        const { rank } = await fetchRiotRank(lolUsername, lolServer);
        return { status: "found" as const, rank };
      } catch (err) {
        if (err instanceof ActionError && err.code === "NOT_FOUND") {
          return { status: "not_found" as const };
        }
        if (err instanceof ActionError && err.code === "BAD_REQUEST") {
          return { status: "invalid" as const, reason: "format" as const };
        }
        if (err instanceof ActionError && err.code === "INTERNAL_SERVER_ERROR") {
          console.error("[checkRiotProfile] fuente de rango no disponible:", err.message);
          return { status: "error" as const, reason: "riot_down" as const };
        }
        console.error("[checkRiotProfile] unexpected error:", err);
        return { status: "error" as const, reason: "unknown" as const };
      }
    }
  })
};
