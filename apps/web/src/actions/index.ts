import { defineAction, ActionError } from "astro:actions";
import { z } from "astro:schema";
import { createSupabaseAdminClient } from "../lib/supabaseServer";
import {
  getSession,
  createSession,
  destroySession,
  getAdminSession,
  createAdminSession,
  destroyAdminSession,
  panelPassphraseMatches
} from "../lib/session";
import { hashPassword, verifyPassword } from "../lib/password";
import { fetchEventState } from "../lib/eventState";
import {
  ParticipantStatsSchema,
  isPasswordValid,
  PASSWORD_MIN_LENGTH,
  JudgeCardSchema,
  fetchMmradarProfile,
  MmradarLookupError,
  generateTeamMatches,
  EngineMatchSchema,
  type TeamGenerationMode,
  type MmradarPerformanceScores,
  type MmradarProfileResult,
  type MmradarTitle
} from "@velada/core";
import type { AppSession, AdminSession } from "../lib/session";

type EngineMatch = z.infer<typeof EngineMatchSchema>;

function requireSession(session: AppSession | null): AppSession {
  if (!session) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "No autenticado." });
  }
  return session;
}

function requirePanelAuth(session: AdminSession | null): AdminSession {
  if (!session) {
    throw new ActionError({ code: "FORBIDDEN", message: "No autenticado como host." });
  }
  return session;
}

function mmradarErrorMessage(reason: MmradarLookupError["reason"]): string {
  switch (reason) {
    case "not_found":
      return "No encontramos ese Riot ID. Revisa que este bien escrito.";
    case "invalid_riot_id":
      return 'Formato invalido. Usa "NombreDeInvocador#TAG" (Riot ID).';
    case "source_unavailable":
      return "No pudimos consultar tu rango ahora mismo. Se reintentara al guardar.";
    case "unexpected_format":
      return "No pudimos leer tu rango ahora mismo. Se reintentara al guardar.";
    default:
      return "No pudimos consultar tu rango ahora mismo. Se reintentara al guardar.";
  }
}

function actionErrorCodeForMmradarLookup(reason: MmradarLookupError["reason"]): "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR" {
  switch (reason) {
    case "not_found":
      return "NOT_FOUND";
    case "invalid_riot_id":
      return "BAD_REQUEST";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}

interface OfficialRankResult {
  rank: string;
  lp: number;
}

async function fetchOfficialRank(lolUsername: string): Promise<OfficialRankResult> {
  try {
    const result = await fetchMmradarProfile(lolUsername);
    if (!result.currentRank) {
      return { rank: "Sin clasificar", lp: 0 };
    }
    return { rank: result.currentRank.rank, lp: result.currentRank.leaguePoints };
  } catch (err) {
    if (err instanceof MmradarLookupError) {
      throw new ActionError({
        code: actionErrorCodeForMmradarLookup(err.reason),
        message: mmradarErrorMessage(err.reason)
      });
    }
    throw new ActionError({
      code: "INTERNAL_SERVER_ERROR",
      message: mmradarErrorMessage("source_unavailable")
    });
  }
}

interface MmradarLookupResult {
  rank: string | null;
  lp: number;
  performanceRank: string | null;
  performanceScores: MmradarPerformanceScores | null;
  titles: MmradarTitle[] | null;
  iconUrl: string | null;
  server: string | null;
  level: number | null;
  /** Habilidad 1v1 propia (ver packages/core/duelRating.ts). null si no hubo partidas suficientes. */
  duelRating: number | null;
  duelConfidence: number | null;
  /**
   * Partidas crudas ya reducidas al shape de TitleEngineMatch (ver
   * MmradarProfileResult.engineMatches en mmradarScraper.ts), persistidas
   * en participants.mmradar_engine_matches SOLO para calibracion offline
   * (scripts/test-rank-calibration.test.ts) -- nunca se usa en el render
   * de ninguna pagina. null si no hubo partidas recientes disponibles.
   */
  engineMatches: EngineMatch[] | null;
}

async function fetchMmradarData(lolUsername: string): Promise<MmradarLookupResult> {
  try {
    const result: MmradarProfileResult = await fetchMmradarProfile(lolUsername);
    return {
      rank: result.currentRank?.rank ?? null,
      lp: result.currentRank?.leaguePoints ?? 0,
      performanceRank: result.performanceRank,
      performanceScores: result.performanceScores,
      titles: result.titles.length > 0 ? result.titles : null,
      iconUrl: result.iconUrl,
      server: result.server,
      level: result.level,
      duelRating: result.duelRating?.rating ?? null,
      duelConfidence: result.duelRating?.confidence ?? null,
      engineMatches: result.engineMatches
    };
  } catch (err) {
    if (err instanceof MmradarLookupError) {
      console.warn(`[fetchMmradarData] ${lolUsername}: ${err.reason} — ${err.message}`);
    } else {
      console.warn(`[fetchMmradarData] ${lolUsername}: error inesperado`, err);
    }
    return {
      rank: null,
      lp: 0,
      performanceRank: null,
      performanceScores: null,
      titles: null,
      iconUrl: null,
      server: null,
      level: null,
      duelRating: null,
      duelConfidence: null,
      engineMatches: null
    };
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
  adminLogin: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email(),
      passphrase: z.string().min(1)
    }),
    handler: async ({ email, passphrase }, context) => {
      if (!panelPassphraseMatches(context, passphrase)) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Credenciales invalidas." });
      }

      await createAdminSession(context.cookies, email.trim().toLowerCase());
      return { success: true };
    }
  }),

  adminLogout: defineAction({
    handler: async (_input, context) => {
      destroyAdminSession(context.cookies);
      return { success: true };
    }
  }),

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

      return { exists: !!data };
    }
  }),

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

  saveOwnParticipant: defineAction({
    accept: "form",
    input: z.object(ownParticipantFields),
    handler: async (input, context) => {
      const session = requireSession(await getSession(context.cookies, context));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { data: existing } = await admin
        .from("participants")
        .select("id, photo, banner, lol_rank")
        .eq("owner_user_id", session.userId)
        .maybeSingle();

      const mmradar = await fetchMmradarData(input.lolUsername);
      const rank = mmradar.rank ?? existing?.lol_rank ?? "Sin clasificar";

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
        performance_rank: mmradar.performanceRank,
        performance_scores: mmradar.performanceScores,
        titles: mmradar.titles,
        mmradar_icon_url: mmradar.iconUrl,
        mmradar_server: mmradar.server,
        mmradar_level: mmradar.level,
        duel_rating: mmradar.duelRating,
        duel_confidence: mmradar.duelConfidence,
        mmradar_engine_matches: mmradar.engineMatches,
        mmradar_updated_at: new Date().toISOString(),
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
      requirePanelAuth(await getAdminSession(context.cookies));
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

      const mmradar = input.lolUsername
        ? await fetchMmradarData(input.lolUsername)
        : {
            performanceRank: null,
            performanceScores: null,
            titles: null,
            iconUrl: null,
            server: null,
            level: null,
            duelRating: null,
            duelConfidence: null,
            engineMatches: null
          };

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
        performance_rank: mmradar.performanceRank,
        performance_scores: mmradar.performanceScores,
        titles: mmradar.titles,
        mmradar_icon_url: mmradar.iconUrl,
        mmradar_server: mmradar.server,
        mmradar_level: mmradar.level,
        duel_rating: mmradar.duelRating,
        duel_confidence: mmradar.duelConfidence,
        mmradar_engine_matches: mmradar.engineMatches,
        mmradar_updated_at: new Date().toISOString(),
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
      requirePanelAuth(await getAdminSession(context.cookies));
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

    refreshMmradarData: defineAction({
    accept: "form",
    input: z.object({ id: z.string().min(1) }),
    handler: async ({ id }, context) => {
      const [playerSession, adminSession] = await Promise.all([
        getSession(context.cookies, context),
        getAdminSession(context.cookies)
      ]);

      if (!playerSession && !adminSession) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "Inicia sesion para poder actualizar un perfil." });
      }

      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { data: existing, error: fetchError } = await admin
        .from("participants")
        .select("id, lol_username, lol_rank")
        .eq("id", id)
        .maybeSingle();

      if (fetchError || !existing) {
        throw new ActionError({ code: "NOT_FOUND", message: "Participante no encontrado." });
      }

      if (!existing.lol_username) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Este perfil no tiene un Riot ID cargado." });
      }

      const mmradar = await fetchMmradarData(existing.lol_username);
      const rank = mmradar.rank ?? existing.lol_rank ?? "Sin clasificar";
      const updatedAt = new Date().toISOString();

      const { error } = await admin
        .from("participants")
        .update({
          lol_rank: rank,
          performance_rank: mmradar.performanceRank,
          performance_scores: mmradar.performanceScores,
          titles: mmradar.titles,
          mmradar_icon_url: mmradar.iconUrl,
          mmradar_server: mmradar.server,
          mmradar_level: mmradar.level,
          duel_rating: mmradar.duelRating,
          duel_confidence: mmradar.duelConfidence,
          mmradar_engine_matches: mmradar.engineMatches,
          mmradar_updated_at: updatedAt,
          updated_at: updatedAt
        })
        .eq("id", id);

      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      return {
        success: true,
        lolRank: rank,
        performanceRank: mmradar.performanceRank,
        performanceScores: mmradar.performanceScores,
        titles: mmradar.titles,
        mmradarIconUrl: mmradar.iconUrl,
        mmradarServer: mmradar.server,
        mmradarLevel: mmradar.level,
        duelRating: mmradar.duelRating,
        duelConfidence: mmradar.duelConfidence,
        mmradarUpdatedAt: updatedAt
      };
    }
  }),

  lookupRank: defineAction({
    accept: "form",
    input: z.object({
      lolUsername: z.string().min(1)
    }),
    handler: async ({ lolUsername }, context) => {
      requirePanelAuth(await getAdminSession(context.cookies));
      return fetchOfficialRank(lolUsername);
    }
  }),

  saveMatch: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().uuid().optional(),
      matchNumber: z.coerce.number().int().positive().optional(),
      name: z.string().optional(),
      player1Id: z.string().min(1),
      player2Id: z.string().min(1),
      winnerId: z.string().optional(),
      decision: z.string().optional(),
      judgeCards: z.string().optional(),
      predictionsOpen: z.coerce.boolean().default(false)
    }),
    handler: async (input, context) => {
      requirePanelAuth(await getAdminSession(context.cookies));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      if (input.player1Id === input.player2Id) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Elegi dos peleadores distintos." });
      }

      let parsedJudgeCards: unknown;
      if (input.judgeCards) {
        try {
          parsedJudgeCards = z.array(JudgeCardSchema).parse(JSON.parse(input.judgeCards));
        } catch {
          throw new ActionError({ code: "BAD_REQUEST", message: "Tarjetas de jueces invalidas." });
        }
      }

      const row = {
        ...(input.id ? { id: input.id } : {}),
        match_number: input.matchNumber ?? null,
        name: input.name || null,
        player1_id: input.player1Id,
        player2_id: input.player2Id,
        winner_id: input.winnerId || null,
        decision: input.decision || null,
        judge_cards: parsedJudgeCards ?? null,
        predictions_open: input.predictionsOpen,
        is_random: false
      };

      const { data, error } = await admin.from("matches").upsert(row).select("id").single();
      if (error || !data) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error?.message ?? "No se pudo guardar el combate." });
      }

      return { success: true, id: data.id };
    }
  }),

  deleteMatch: defineAction({
    accept: "form",
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, context) => {
      requirePanelAuth(await getAdminSession(context.cookies));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { error } = await admin.from("matches").delete().eq("id", id);
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      return { success: true };
    }
  }),

  checkRiotProfile: defineAction({
    accept: "form",
    input: z.object({
      lolUsername: z.string().min(1)
    }),
    handler: async ({ lolUsername }) => {
      const [gameName, tagLine] = lolUsername.split("#");
      if (!gameName || !tagLine) {
        return { status: "invalid" as const, reason: "format" as const };
      }

      // Antes esto hacia DOS fetches HTTP separados al mismo perfil de
      // mmradar (fetchOfficialRank para el rango + fetchMmradarData para
      // performanceScores) -- ademas del gasto doble, si el segundo
      // fallaba (rate-limit, timing) el rango se mostraba bien pero las
      // barras de performance quedaban en null sin que se notara ningun
      // error (fetchMmradarData nunca lanza, por diseno). Un solo fetch a
      // fetchMmradarData ya trae todo lo que hace falta aca.
      const mmradar = await fetchMmradarData(lolUsername);
      let fallbackRank: string | null = null;

      if (mmradar.rank === null && mmradar.performanceScores === null) {
        // fetchMmradarData nunca lanza -- para distinguir "no encontrado"
        // de "fuente caida"/"formato invalido" (los 3 casos que
        // fetchOfficialRank SI distingue lanzando ActionError) se hace un
        // segundo intento con fetchOfficialRank solo cuando el primero no
        // trajo nada, no en el camino feliz.
        try {
          fallbackRank = (await fetchOfficialRank(lolUsername)).rank;
        } catch (err) {
          if (err instanceof ActionError && err.code === "NOT_FOUND") {
            return { status: "not_found" as const };
          }
          if (err instanceof ActionError && err.code === "BAD_REQUEST") {
            return { status: "invalid" as const, reason: "format" as const };
          }
          console.error("[checkRiotProfile] fuente de rango no disponible:", err instanceof Error ? err.message : err);
          return { status: "error" as const, reason: "riot_down" as const };
        }
      }

      return {
        status: "found" as const,
        rank: mmradar.rank ?? fallbackRank ?? "Sin clasificar",
        performanceRank: mmradar.performanceRank,
        performanceScores: mmradar.performanceScores,
        titles: mmradar.titles,
        iconUrl: mmradar.iconUrl,
        server: mmradar.server,
        level: mmradar.level,
        duelRating: mmradar.duelRating,
        duelConfidence: mmradar.duelConfidence
      };
    }
  }),

  saveTeamMatch: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().uuid().optional(),
      name: z.string().optional(),
      teamAIds: z.string().min(1),
      teamBIds: z.string().min(1),
      winnerTeam: z.enum(["A", "B"]).optional(),
      generationMode: z.enum(["manual", "random", "balanced", "unfair"]).default("manual")
    }),
    handler: async (input, context) => {
      requirePanelAuth(await getAdminSession(context.cookies));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      let teamAIds: string[];
      let teamBIds: string[];
      try {
        teamAIds = z.array(z.string().min(1)).min(1).parse(JSON.parse(input.teamAIds));
        teamBIds = z.array(z.string().min(1)).min(1).parse(JSON.parse(input.teamBIds));
      } catch {
        throw new ActionError({ code: "BAD_REQUEST", message: "Equipos invalidos." });
      }

      if (teamAIds.length !== teamBIds.length) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Ambos equipos deben tener el mismo numero de jugadores." });
      }

      const overlap = teamAIds.some((id) => teamBIds.includes(id));
      if (overlap) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Un mismo jugador no puede estar en los dos equipos." });
      }

      const row = {
        ...(input.id ? { id: input.id } : {}),
        name: input.name || null,
        team_a_ids: teamAIds,
        team_b_ids: teamBIds,
        winner_team: input.winnerTeam ?? null,
        generation_mode: input.generationMode
      };

      const { data, error } = await admin.from("team_matches").upsert(row).select("id").single();
      if (error || !data) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error?.message ?? "No se pudo guardar el combate por equipos." });
      }

      return { success: true, id: data.id };
    }
  }),

  deleteTeamMatch: defineAction({
    accept: "form",
    input: z.object({ id: z.string().uuid() }),
    handler: async ({ id }, context) => {
      requirePanelAuth(await getAdminSession(context.cookies));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { error } = await admin.from("team_matches").delete().eq("id", id);
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      return { success: true };
    }
  }),

  generateTeamMatchesAction: defineAction({
    accept: "form",
    input: z.object({
      participantIds: z.string().min(1),
      mode: z.enum(["random", "balanced", "unfair"])
    }),
    handler: async (input, context) => {
      requirePanelAuth(await getAdminSession(context.cookies));
      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      let participantIds: string[];
      try {
        participantIds = z.array(z.string().min(1)).min(1).parse(JSON.parse(input.participantIds));
      } catch {
        throw new ActionError({ code: "BAD_REQUEST", message: "Lista de participantes invalida." });
      }

      const { data: rows, error: fetchError } = await admin
        .from("participants")
        .select("id, lol_rank, performance_scores")
        .in("id", participantIds);

      if (fetchError || !rows) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: fetchError?.message ?? "No se pudieron cargar los participantes." });
      }

      const balancerInput = rows.map((r) => ({
        id: r.id as string,
        lolRank: (r.lol_rank as string | null) ?? undefined,
        performanceScores: (r.performance_scores as MmradarPerformanceScores | null) ?? undefined
      }));

      const mode = input.mode as TeamGenerationMode;
      const { matches, leftOverIds } = generateTeamMatches(balancerInput, mode);

      if (matches.length === 0) {
        throw new ActionError({
          code: "BAD_REQUEST",
          message: "No hay suficientes participantes disponibles (se necesitan al menos 6, para un 3v3)."
        });
      }

      const rowsToInsert = matches.map((m) => ({
        name: null,
        team_a_ids: m.teamAIds,
        team_b_ids: m.teamBIds,
        winner_team: null,
        generation_mode: mode
      }));

      const { data: inserted, error: insertError } = await admin
        .from("team_matches")
        .insert(rowsToInsert)
        .select("id, team_a_ids, team_b_ids, generation_mode, name, winner_team, created_at");

      if (insertError || !inserted) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: insertError?.message ?? "No se pudieron crear los combates por equipos." });
      }

      return { success: true, created: inserted.length, leftOverIds };
    }
  })
};
