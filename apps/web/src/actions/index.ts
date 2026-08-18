import { defineAction, ActionError } from "astro:actions";
import { z } from "astro:schema";
import { createSupabaseAdminClient } from "../lib/supabaseServer";
import { getSession, createSession, destroySession, markPassphraseVerified, isAdminEmail } from "../lib/session";
import { hashPassword, verifyPassword } from "../lib/password";
import { getServerEnv } from "../lib/env";
import { fetchEventState } from "../lib/eventState";
import { ParticipantStatsSchema, isPasswordValid, PASSWORD_MIN_LENGTH } from "@velada/core";
import type { AppSession } from "../lib/session";

const RIOT_PLATFORM_BY_SERVER: Record<string, string> = {
  LAN: "la1",
  LAS: "la2",
  NA: "na1",
  BR: "br1",
  EUW: "euw1",
  EUNE: "eun1",
  KR: "kr",
  JP: "jp1",
  OCE: "oc1"
};

const RIOT_REGION_BY_SERVER: Record<string, string> = {
  LAN: "americas",
  LAS: "americas",
  NA: "americas",
  BR: "americas",
  EUW: "europe",
  EUNE: "europe",
  KR: "asia",
  JP: "asia",
  OCE: "sea"
};

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
 * Looks up a player's current solo queue rank from the Riot API. Shared by
 * the admin lookupRank action (manual "Consultar" button) and
 * saveOwnParticipant (self-service profile save, where the rank is always
 * re-derived server-side so nobody can type in "Challenger" by hand).
 */
async function fetchRiotRank(
  lolUsername: string,
  lolServer: string,
  locals: Parameters<typeof getServerEnv>[0]["locals"]
): Promise<{ rank: string; lp: number }> {
  const riotApiKey = getServerEnv({ locals }, "RIOT_API_KEY");
  if (!riotApiKey) {
    throw new ActionError({
      code: "INTERNAL_SERVER_ERROR",
      message: "RIOT_API_KEY no configurada en el servidor."
    });
  }

  const serverKey = lolServer.toUpperCase();
  const platform = RIOT_PLATFORM_BY_SERVER[serverKey];
  const region = RIOT_REGION_BY_SERVER[serverKey];
  if (!platform || !region) {
    throw new ActionError({
      code: "BAD_REQUEST",
      message: `Servidor "${lolServer}" no reconocido. Usa: ${Object.keys(RIOT_PLATFORM_BY_SERVER).join(", ")}.`
    });
  }

  const [gameName, tagLine] = lolUsername.split("#");
  if (!gameName || !tagLine) {
    throw new ActionError({
      code: "BAD_REQUEST",
      message: 'Formato invalido. Usa "NombreDeInvocador#TAG" (Riot ID).'
    });
  }

  const accountResponse = await fetch(
    `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers: { "X-Riot-Token": riotApiKey } }
  );

  if (accountResponse.status === 404) {
    throw new ActionError({ code: "NOT_FOUND", message: "Riot ID no encontrado." });
  }
  if (accountResponse.status === 429 || accountResponse.status === 403) {
    throw new ActionError({
      code: "TOO_MANY_REQUESTS",
      message: `Riot API (account) rate-limited o key invalida: ${accountResponse.status}`
    });
  }
  if (!accountResponse.ok) {
    throw new ActionError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Riot API (account) fallo: ${accountResponse.status}`
    });
  }

  const account = (await accountResponse.json()) as { puuid: string };

  const leagueResponse = await fetch(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}`,
    { headers: { "X-Riot-Token": riotApiKey } }
  );

  if (leagueResponse.status === 429 || leagueResponse.status === 403) {
    throw new ActionError({
      code: "TOO_MANY_REQUESTS",
      message: `Riot API (league) rate-limited o key invalida: ${leagueResponse.status}`
    });
  }
  if (!leagueResponse.ok) {
    throw new ActionError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Riot API (league) fallo: ${leagueResponse.status}`
    });
  }

  const entries = (await leagueResponse.json()) as Array<{
    queueType: string;
    tier: string;
    rank: string;
    leaguePoints: number;
  }>;

  const soloQueue = entries.find((e) => e.queueType === "RANKED_SOLO_5x5");
  if (!soloQueue) {
    return { rank: "Sin clasificar", lp: 0 };
  }

  const tier = soloQueue.tier.charAt(0) + soloQueue.tier.slice(1).toLowerCase();
  return { rank: `${tier} ${soloQueue.rank}`, lp: soloQueue.leaguePoints };
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

      const { rank } = await fetchRiotRank(input.lolUsername, input.lolServer, context.locals);

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
      return fetchRiotRank(lolUsername, lolServer, context.locals);
    }
  }),

  /**
   * Live-check for the Riot ID + server as the fighter types it in
   * /inscripcion, driving the green check / yellow spinner / red X
   * indicator next to the field before they submit. Requires a logged-in
   * session (not full panel auth) so it stays usable by fighters
   * self-registering, but isn't a fully anonymous endpoint that could burn
   * through the Riot API rate limit. Never throws for the expected "still
   * typing" or "typo" states (not_found / invalid) — only real infra
   * failures (missing key, Riot API down) throw, matching fetchRiotRank's
   * own error semantics.
   */
  checkRiotProfile: defineAction({
    accept: "form",
    input: z.object({
      lolUsername: z.string().min(1),
      lolServer: z.string().min(1)
    }),
    handler: async ({ lolUsername, lolServer }, context) => {
      requireSession(await getSession(context.cookies, context));

      const serverKey = lolServer.toUpperCase();
      if (!RIOT_PLATFORM_BY_SERVER[serverKey]) {
        return { status: "invalid" as const, reason: "server" as const };
      }
      const [gameName, tagLine] = lolUsername.split("#");
      if (!gameName || !tagLine) {
        return { status: "invalid" as const, reason: "format" as const };
      }

      try {
        const { rank } = await fetchRiotRank(lolUsername, lolServer, context.locals);
        return { status: "found" as const, rank };
      } catch (err) {
        if (err instanceof ActionError && err.code === "NOT_FOUND") {
          return { status: "not_found" as const };
        }
        if (err instanceof ActionError && err.code === "BAD_REQUEST") {
          return { status: "invalid" as const, reason: "format" as const };
        }
        if (err instanceof ActionError && err.code === "TOO_MANY_REQUESTS") {
          console.error("[checkRiotProfile] rate limited:", err.message);
          return { status: "error" as const, reason: "rate_limited" as const };
        }
        if (err instanceof ActionError && err.code === "INTERNAL_SERVER_ERROR") {
          console.error("[checkRiotProfile] infra failure:", err.message);
          return { status: "error" as const, reason: "riot_down" as const };
        }
        console.error("[checkRiotProfile] unexpected error:", err);
        return { status: "error" as const, reason: "unknown" as const };
      }
    }
  })
};
