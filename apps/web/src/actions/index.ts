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
  type TeamGenerationMode,
  type MmradarPerformanceScores,
  type MmradarProfileResult
} from "@velada/core";
import type { AppSession, AdminSession } from "../lib/session";

function requireSession(session: AppSession | null): AppSession {
  if (!session) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "No autenticado." });
  }
  return session;
}

/**
 * Panel auth ya NO deriva de la sesion de jugador (participant_users) ni
 * de ADMIN_EMAILS + passphrase-como-paso-aparte. Es una sesion propia
 * (ver lib/session.ts, createAdminSession/getAdminSession) que se obtiene
 * SOLO en /panel-login, pidiendo email + PANEL_PASSPHRASE juntos en el
 * mismo formulario -- antes admitAsAdmin en el login unificado dejaba
 * pasar a cualquier email listado en ADMIN_EMAILS sin pedir nada, y la
 * passphrase quedaba como gate posterior opcional. Cuenta de admin !=
 * cuenta de inscripcion: una no otorga la otra.
 */
function requirePanelAuth(session: AdminSession | null): AdminSession {
  if (!session) {
    throw new ActionError({ code: "FORBIDDEN", message: "No autenticado como host." });
  }
  return session;
}

/**
 * Mensajes de error pensados para el jugador que llena el formulario, sin
 * mencionar de donde viene el dato ni como se obtiene (nada de "scraping",
 * "HTML", nombres de sitios de terceros, etc.) — solo lo que puede hacer
 * al respecto.
 */
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

/**
 * Fuente unica del rango "oficial" de un peleador (el que se guarda como
 * lolRank y se muestra en las fichas): el Current Rank de mmradar.gg (ver
 * packages/core/mmradarScraper.ts). LeagueOfGraphs/rankScraper.ts se
 * elimino por completo — decision explicita del usuario 2026-08-18, ya no
 * se consulta ningun servidor/region para esto, mmradar lo resuelve solo.
 * Lanza ActionError solo para fallas reales (Riot ID invalido, no
 * encontrado, fuente caida) — usada por lookupRank/checkRiotProfile que
 * si necesitan distinguir esos casos del usuario.
 */
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
  titles: string[] | null;
  iconUrl: string | null;
  server: string | null;
}

/**
 * Consulta mmradar.gg una sola vez y devuelve TODO lo que se guarda de ahi
 * (rango oficial, performance rank, scores, titulos) — reemplaza los dos
 * fetches separados que habia antes (uno para el rango "oficial" via
 * LeagueOfGraphs, otro para performance/scores via mmradar). A diferencia
 * de fetchOfficialRank, esto NUNCA lanza: se usa en el flujo de guardado,
 * donde una fuente externa caida no debe romper el guardado del perfil de
 * nadie — si falla, se guardan nulls y el peleador puede reintentar mas
 * tarde (el rango previo en la fila no se pisa con un valor invalido
 * gracias a esto).
 */
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
      server: result.server
    };
  } catch (err) {
    if (err instanceof MmradarLookupError) {
      console.warn(`[fetchMmradarData] ${lolUsername}: ${err.reason} — ${err.message}`);
    } else {
      console.warn(`[fetchMmradarData] ${lolUsername}: error inesperado`, err);
    }
    return { rank: null, lp: 0, performanceRank: null, performanceScores: null, titles: null, iconUrl: null, server: null };
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
   * Login de HOST unicamente, usado solo desde /panel-login. Pide email +
   * PANEL_PASSPHRASE (clave global) juntos en el mismo paso -- antes el
   * login unificado dejaba pasar a cualquier email en ADMIN_EMAILS sin
   * pedir nada, y la passphrase quedaba como gate posterior opcional que
   * en la practica dejaba a un admin "a medio loguear" en el sitio. No
   * toca participant_users/sessions en absoluto: ver
   * createAdminSession en lib/session.ts. El email no necesita estar en
   * ADMIN_EMAILS para intentar el login -- conocer PANEL_PASSPHRASE es
   * el unico secreto real; ADMIN_EMAILS ya no se usa en ningun lado (ver
   * nota mas abajo).
   */
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

  /**
   * Step 1 of the email-first auth flow on /inscripcion: given just an
   * email, tells the client whether an account already exists so the UI
   * can ask for "tu contrasena" (login) vs "crea una contrasena"
   * (register). /inscripcion es 100% para jugadores -- ya no hay ninguna
   * rama de admin aca, un email listado en ADMIN_EMAILS no recibe ningun
   * trato especial (esa deteccion se saco por completo, cuenta de admin
   * != cuenta de inscripcion).
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

      return { exists: !!data };
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
   * always re-derived server-side here (mmradar.gg, ver fetchMmradarData) —
   * the form only ever sends lolUsername, never a free-text rank, so
   * nobody can claim Challenger by typing it in. Una sola consulta a
   * mmradar cubre tanto el rango oficial como performance/scores/titulos
   * (antes eran dos fetches a fuentes distintas).
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

      const { data: existing } = await admin
        .from("participants")
        .select("id, photo, banner, lol_rank")
        .eq("owner_user_id", session.userId)
        .maybeSingle();

      const mmradar = await fetchMmradarData(input.lolUsername);
      // Si mmradar no devolvio rango (fuente caida, bloqueo anti-bot, etc.)
      // se conserva el rango ya guardado en vez de pisarlo con "Sin
      // clasificar" — eso confundiria a un jugador que si tiene rango real
      // pero la fuente fallo momentaneamente. Solo se usa "Sin clasificar"
      // cuando no hay ningun valor previo (alta nueva) ni nuevo.
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

      // mmradar solo se puede consultar si hay un Riot ID cargado (el panel
      // permite crear/editar participantes sin lolUsername a mano) -- a
      // diferencia de saveOwnParticipant, aca no es obligatorio.
      const mmradar = input.lolUsername
        ? await fetchMmradarData(input.lolUsername)
        : { performanceRank: null, performanceScores: null, titles: null, iconUrl: null, server: null };

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

  /**
   * Re-consulta mmradar.gg para un participante ya guardado y actualiza
   * SOLO los campos que vienen de ahi (lol_rank, performance rank,
   * performance scores, titles, mmradar_icon_url, mmradar_server).
   * Pensada para el boton "Update" en la ficha publica del jugador
   * (/peleadores/[id]), que tambien mueve la barra de performance de la
   * carta izquierda porque toca la misma fila.
   * Permitido al dueno del perfil o a un admin de panel; nadie mas puede
   * forzar una re-consulta de un perfil ajeno.
   * Igual que saveOwnParticipant, si mmradar no responde se conserva el
   * lol_rank ya guardado en vez de pisarlo con "Sin clasificar".
   */
    refreshMmradarData: defineAction({
    accept: "form",
    input: z.object({ id: z.string().min(1) }),
    handler: async ({ id }, context) => {
      // El dueno del perfil se resuelve con la sesion de jugador; un admin
      // (sesion separada, ver lib/session.ts) tambien puede forzar el
      // refresh de cualquier perfil. Ninguna de las dos otorga la otra —
      // se piden ambas por separado en vez de una sola sesion con flags.
      const [playerSession, adminSession] = await Promise.all([
        getSession(context.cookies, context),
        getAdminSession(context.cookies)
      ]);

      if (!playerSession && !adminSession) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "No autenticado." });
      }

      const [admin, msg] = createSupabaseAdminClient(context.locals);
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: msg });
      }

      const { data: existing, error: fetchError } = await admin
        .from("participants")
        .select("id, owner_user_id, lol_username, lol_rank")
        .eq("id", id)
        .maybeSingle();

      if (fetchError || !existing) {
        throw new ActionError({ code: "NOT_FOUND", message: "Participante no encontrado." });
      }

      const isOwner = playerSession ? existing.owner_user_id === playerSession.userId : false;
      if (!isOwner && !adminSession) {
        throw new ActionError({ code: "FORBIDDEN", message: "No podes actualizar el perfil de otro jugador." });
      }

      if (!existing.lol_username) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Este perfil no tiene un Riot ID cargado." });
      }

      const mmradar = await fetchMmradarData(existing.lol_username);
      const rank = mmradar.rank ?? existing.lol_rank ?? "Sin clasificar";

      const { error } = await admin
        .from("participants")
        .update({
          lol_rank: rank,
          performance_rank: mmradar.performanceRank,
          performance_scores: mmradar.performanceScores,
          titles: mmradar.titles,
          mmradar_icon_url: mmradar.iconUrl,
          mmradar_server: mmradar.server,
          updated_at: new Date().toISOString()
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
        mmradarServer: mmradar.server
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

  /**
   * Crea o edita un combate a mano desde /gestion-roster-x9f2 (pestana
   * Evento). Cubre lo mismo que la ruleta (player1/player2) mas todo lo
   * que la ruleta no toca: nombre del combate (etiqueta libre, ej.
   * "Semifinal"), numero de orden, resultado oficial (winnerId +
   * decision), tarjetas de jueces, y si esta abierto a pronosticos. Sin
   * id -> crea; con id -> actualiza esa fila (nunca upsert por otra
   * clave, a diferencia de participants no hay ningun campo natural tipo
   * owner_user_id para eso aca).
   */
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

  /**
   * Live-check for the Riot ID as the fighter types it in /inscripcion,
   * driving the green check / yellow spinner / red X indicator next to
   * the field before they submit. Tambien devuelve performanceScores (y
   * el resto de lo que trae mmradar) para que el preview en vivo
   * (ParticipantProfileForm) pueda dibujar las barras de performance
   * antes de guardar -- antes solo devolvia el rango, asi que el preview
   * nunca tenia con que mostrar esa carta mientras el jugador todavia
   * estaba completando el formulario. Ya no recibe/valida lolServer —
   * mmradar no lo necesita (resuelve la region del lado de ellos).
   * Requires a logged-in session (not full panel auth) so it stays usable
   * by fighters self-registering. Never throws for the expected "still
   * typing" or "typo" states (not_found / invalid) — only real infra
   * failures (fuente externa caida/formato inesperado) throw, matching
   * fetchOfficialRank's own error semantics (sigue usando
   * fetchOfficialRank solo para distinguir esos casos de error; el resto
   * de datos vienen de fetchMmradarData, que nunca lanza).
   */
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

      try {
        const { rank } = await fetchOfficialRank(lolUsername);
        const mmradar = await fetchMmradarData(lolUsername);
        return {
          status: "found" as const,
          rank,
          performanceRank: mmradar.performanceRank,
          performanceScores: mmradar.performanceScores
        };
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
  }),

  /**
   * Crea o edita un team match a mano desde /gestion-roster-x9f2 (pestana
   * Equipos): usado tanto para el editor manual (elegir team A/B a mano)
   * como para persistir el resultado (winnerTeam) de un match ya generado.
   * Sin id -> crea (generationMode "manual" por default, ver
   * generateTeamMatchesAction para el resto de modos); con id -> actualiza
   * esa fila. teamAIds/teamBIds llegan como JSON (arrays de participant
   * ids) porque FormData no serializa arrays de forma nativa util aca.
   */
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

  /**
   * Genera uno o mas team matches de una sola vez a partir de los
   * participantes disponibles (el cliente ya filtro los excluidos via el
   * checklist de /gestion-roster-x9f2 antes de llamar esto -- ver decision
   * del usuario: no hay exclusion automatica por resultado pendiente, es
   * el admin quien marca a mano). Trae el skill rating de cada uno desde
   * participants (performance_scores / lol_rank) para que
   * generateTeamMatches (packages/core/teamBalancer.ts) pueda balancear
   * balanced/unfair, arma los bloques (5v5, o mezclas de 4v4/3v3 si el
   * total no es multiplo de 10 -- ver planTeamBlockSizes), y persiste cada
   * bloque como una fila de team_matches en un solo insert.
   */
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
