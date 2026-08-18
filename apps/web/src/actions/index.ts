import { defineAction, ActionError } from "astro:actions";
import { z } from "astro:schema";
import { createSupabaseServerClient, createSupabaseAdminClient } from "../lib/supabaseServer";
import { getPanelSession, markPassphraseVerified } from "../lib/panelSession";
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

export const server = {
  login: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email(),
      password: z.string().min(6)
    }),
    handler: async ({ email, password }, context) => {
      const supabase = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase no configurado." });
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
      const supabase = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase no configurado." });
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
      const supabase = createSupabaseServerClient(context.request, context.cookies);
      if (supabase) await supabase.auth.signOut();
      context.cookies.delete("velada_panel_unlocked", { path: "/" });
      return { success: true };
    }
  }),

  verifyPassphrase: defineAction({
    accept: "form",
    input: z.object({ passphrase: z.string().min(1) }),
    handler: async ({ passphrase }, context) => {
      const session = requirePanelAuth(await getPanelSession(context.request, context.cookies));
      const supabase = createSupabaseServerClient(context.request, context.cookies);
      if (!supabase) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase no configurado." });
      }

      const { data, error } = await supabase.rpc("verify_panel_passphrase", { input: passphrase });
      if (error || !data) {
        throw new ActionError({ code: "FORBIDDEN", message: "Clave incorrecta." });
      }

      markPassphraseVerified(context.cookies);
      return { success: true };
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
      lolRank: z.string().min(1),
      lolUsername: z.string().optional(),
      lolServer: z.string().optional(),
      mainRole: z.enum(["Top", "Jungle", "Mid", "ADC", "Support"]),
      favChampion: z.string().min(1),
      description: z.string().optional(),
      stats: z.string().optional(),
      photo: z.instanceof(File).optional()
    }),
    handler: async (input, context) => {
      requirePanelAuth(await getPanelSession(context.request, context.cookies));
      const admin = createSupabaseAdminClient();
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase admin no configurado." });
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
        lol_rank: input.lolRank,
        lol_username: input.lolUsername || null,
        lol_server: input.lolServer || null,
        main_role: input.mainRole,
        fav_champion: input.favChampion,
        description: input.description || null,
        stats: parsedStats ?? null,
        updated_at: new Date().toISOString(),
        ...(photoUrl ? { photo: photoUrl } : {})
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
      const admin = createSupabaseAdminClient();
      if (!admin) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase admin no configurado." });
      }

      const { error } = await admin.from("participants").delete().eq("id", id);
      if (error) {
        throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      return { success: true };
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
  })
};
