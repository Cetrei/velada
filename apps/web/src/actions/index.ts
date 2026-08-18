import { defineAction, ActionError } from "astro:actions";
import { z } from "astro:schema";
import { createSupabaseServerClient, createSupabaseAdminClient } from "../lib/supabaseServer";
import { getPanelSession, markPassphraseVerified } from "../lib/panelSession";
import { getParticipantSession } from "../lib/participantSession";
import { fetchEventState } from "../lib/eventState";
import { ParticipantStatsSchema } from "@velada/core";

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

function requirePanelAuth<T>(session: T | null): T {
  if (!session) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "No autenticado." });
  }
  return session;
}

/**
 * Looks up a player's current solo queue rank from the Riot API. Shared by
 * the admin lookupRank action (manual "Consultar" button) and
 * saveOwnParticipant (self-service profile save, where the rank is always
 * re-derived server-side so nobody can type in "Challenger" by hand).
 */
async function fetchRiotRank(lolUsername: string, lolServer: string): Promise<{ rank: string; lp: number }> {
  const riotApiKey = import.meta.env.RIOT_API_KEY;
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
  login: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email(),
      password: z.string().min(6)
    }),
    handler: async ({ email, password }, context) => {
      const [supabase, msg] = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Credenciales invalidas." });
      }

      const session = await getPanelSession(context.request, context.cookies, supabase);
      if (!session) {
        await supabase.auth.signOut();
        throw new ActionError({
          code: "FORBIDDEN",
          message: "Tu cuenta no tiene acceso al panel."
        });
      }

      return { success: true };
    }
  }),

  /**
   * Completes a magic link / invite login. Supabase's action_link (from
   * admin.generateLink) redirects the browser to redirect_to with the
   * session tokens in the URL fragment (#access_token=...&refresh_token=...)
   * instead of cookies, because that redirect is a plain browser navigation
   * with no server involved. The client-side script in panel-login.astro
   * reads that fragment and calls this action, which runs
   * supabase.auth.setSession() on the server so @supabase/ssr writes the
   * actual session cookies getPanelSession() reads on every other page.
   *
   * Passes `supabase` itself into getPanelSession instead of letting it
   * create a fresh client - see the comment on getPanelSession for why a
   * fresh client fails right after setSession() in the same request.
   */
  establishMagicLinkSession: defineAction({
    input: z.object({
      accessToken: z.string().min(1),
      refreshToken: z.string().min(1)
    }),
    handler: async ({ accessToken, refreshToken }, context) => {
      const [supabase, msg] = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Link invalido o expirado." });
      }

      const session = await getPanelSession(context.request, context.cookies, supabase);
      if (!session) {
        await supabase.auth.signOut();
        throw new ActionError({
          code: "FORBIDDEN",
          message: "Tu cuenta no tiene acceso al panel."
        });
      }

      return { success: true };
    }
  }),

  logout: defineAction({
    handler: async (_input, context) => {
      const [supabase, msg] = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      
      await supabase.auth.signOut();
      context.cookies.delete("velada_panel_unlocked", { path: "/" });
      return { success: true };
    }
  }),

  verifyPassphrase: defineAction({
    accept: "form",
    input: z.object({ passphrase: z.string().min(1) }),
    handler: async ({ passphrase }, context) => {
      const session = requirePanelAuth(await getPanelSession(context.request, context.cookies));
      const [supabase, msg] = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { data, error } = await supabase.rpc("verify_panel_passphrase", { input: passphrase });
      if (error || !data) {
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
   * Uses the admin REST endpoint directly (same one scripts/setup-supabase.ts
   * uses for invites) because the supabase-js admin client has no
   * getUserByEmail helper, only paginated listUsers().
   */
  checkEmailExists: defineAction({
    accept: "form",
    input: z.object({ email: z.string().email() }),
    handler: async ({ email }) => {
      const url = import.meta.env.PUBLIC_SUPABASE_URL;
      const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !serviceRoleKey) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase no configurado." });
      }

      const response = await fetch(`${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      });

      if (!response.ok) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo verificar el email." });
      }

      const data = (await response.json()) as { users: Array<{ email?: string }> };
      const exists = data.users.some((u) => u.email?.toLowerCase() === email.toLowerCase());
      return { exists };
    }
  }),

  /**
   * Self-registration for fighters: plain Supabase Auth signUp, no invite
   * needed (unlike the admin flow in panel-login). Logs the user in
   * immediately after creating the account (no separate login step) so
   * /inscripcion can go straight from "crea tu contrasena" to the profile
   * form in one submit.
   */
  registerParticipant: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email(),
      password: z.string().min(6)
    }),
    handler: async ({ email, password }, context) => {
      const eventState = await fetchEventState();
      if (!eventState.registrationsOpen) {
        throw new ActionError({ code: "FORBIDDEN", message: "Las inscripciones estan cerradas." });
      }

      const [supabase, msg] = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        throw new ActionError({ code: "BAD_REQUEST", message: signUpError.message });
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        throw new ActionError({ code: "UNAUTHORIZED", message: signInError.message });
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
      const [supabase, msg] = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Credenciales invalidas." });
      }

      return { success: true };
    }
  }),

  logoutParticipant: defineAction({
    handler: async (_input, context) => {
      const [supabase, msg] = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }
      await supabase.auth.signOut();
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
      const session = requirePanelAuth(await getParticipantSession(context.request, context.cookies));
      const [admin, msg] = createSupabaseAdminClient();
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
      requirePanelAuth(await getPanelSession(context.request, context.cookies));
      const [admin, msg] = createSupabaseAdminClient();
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
      requirePanelAuth(await getPanelSession(context.request, context.cookies));
      const [admin, msg] = createSupabaseAdminClient();
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
      requirePanelAuth(await getPanelSession(context.request, context.cookies));
      return fetchRiotRank(lolUsername, lolServer);
    }
  }),

  /**
   * Live-check for the Riot ID + server as the fighter types it in
   * /inscripcion, driving the green check / yellow spinner / red X
   * indicator next to the field before they submit. Requires a
   * participant session (not full panel auth) so it stays usable by
   * fighters self-registering, but isn't a fully anonymous endpoint that
   * could burn through the Riot API rate limit. Never throws for the
   * expected "still typing" or "typo" states (not_found / invalid) — only
   * real infra failures (missing key, Riot API down) throw, matching
   * fetchRiotRank's own error semantics.
   */
  checkRiotProfile: defineAction({
    accept: "form",
    input: z.object({
      lolUsername: z.string().min(1),
      lolServer: z.string().min(1)
    }),
    handler: async ({ lolUsername, lolServer }, context) => {
      requirePanelAuth(await getParticipantSession(context.request, context.cookies));

      const serverKey = lolServer.toUpperCase();
      if (!RIOT_PLATFORM_BY_SERVER[serverKey]) {
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
        throw err;
      }
    }
  })
};
