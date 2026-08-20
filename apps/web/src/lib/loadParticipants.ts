import { parseParticipants, parseMemeParticipants, ParticipantListSchema, ParticipantSchema, type Participant } from "@velada/core";
import type { APIContext } from "astro";
import { getSupabaseClient } from "./supabase";
import { createSupabaseAdminClient } from "./supabaseServer";

const yamlModules = import.meta.glob("../data/participants.yml", {
  eager: true,
  query: "?raw",
  import: "default"
}) as Record<string, string>;

const PARTICIPANTS_YAML = Object.values(yamlModules)[0] ?? "";

const memeYamlModules = import.meta.glob("../data/meme-participants.yml", {
  eager: true,
  query: "?raw",
  import: "default"
}) as Record<string, string>;

const MEME_PARTICIPANTS_YAML = Object.values(memeYamlModules)[0] ?? "";

/** Bundled fallback used when Supabase isn't configured or the table is empty. */
function loadYamlParticipants(): Participant[] {
  return parseParticipants(PARTICIPANTS_YAML);
}

/**
 * Participantes "de meme" (excludeFromMatches: true) -- viven solo en este
 * YAML, nunca en Supabase (ver comentario en el propio archivo y en
 * ParticipantSchema.excludeFromMatches). Se agregan SIEMPRE al final del
 * roster real, tanto si ese roster vino de Supabase como del YAML de
 * fallback -- a diferencia de participants.yml, este archivo no es un
 * fallback de demo, es contenido real que debe aparecer siempre.
 */
function loadMemeParticipants(): Participant[] {
  return parseMemeParticipants(MEME_PARTICIPANTS_YAML);
}

interface ParticipantRow {
  id: string;
  name: string;
  nickname: string;
  photo: string | null;
  banner: string | null;
  age: number | null;
  weight: string | null;
  height: string | null;
  country: string | null;
  country_flag: string | null;
  instagram_handle: string | null;
  instagram_followers: string | null;
  x_handle: string | null;
  x_followers: string | null;
  lol_rank: string;
  lol_username: string | null;
  lol_server: string | null;
  main_role: Participant["mainRole"];
  fav_champion: string;
  description: string | null;
  stats: Participant["stats"] | null;
  performance_rank: string | null;
  performance_scores: Participant["performanceScores"] | null;
  titles: string[] | null;
  mmradar_icon_url: string | null;
  mmradar_server: string | null;
}

function toParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    photo: row.photo ?? undefined,
    banner: row.banner ?? undefined,
    age: row.age ?? undefined,
    weight: row.weight ?? undefined,
    height: row.height ?? undefined,
    country: row.country ?? undefined,
    countryFlag: row.country_flag ?? undefined,
    instagramHandle: row.instagram_handle ?? undefined,
    instagramFollowers: row.instagram_followers ?? undefined,
    xHandle: row.x_handle ?? undefined,
    xFollowers: row.x_followers ?? undefined,
    lolRank: row.lol_rank,
    lolUsername: row.lol_username ?? undefined,
    lolServer: row.lol_server ?? undefined,
    mainRole: row.main_role,
    favChampion: row.fav_champion,
    description: row.description ?? undefined,
    stats: row.stats ?? undefined,
    performanceRank: row.performance_rank ?? undefined,
    performanceScores: row.performance_scores ?? undefined,
    titles: row.titles ?? undefined,
    mmradarIconUrl: row.mmradar_icon_url ?? undefined,
    mmradarServer: row.mmradar_server ?? undefined
  };
}

/**
 * Source of truth for the roster shown across the site. Reads live from
 * Supabase (the same table the admin panel writes to via saveParticipant /
 * deleteParticipant) so admin edits show up immediately without a redeploy.
 * Falls back to the bundled participants.yml when Supabase isn't configured,
 * the query fails, or the table is empty — same fallback strategy as
 * eventState.ts, so the site never renders blank.
 * Los participantes meme (loadMemeParticipants, ver comentario mas arriba)
 * se agregan siempre al final, sin importar de donde vino el resto del
 * roster -- no son un fallback, son contenido real que debe estar
 * presente aunque Supabase este funcionando perfecto.
 */
export async function loadParticipants(): Promise<Participant[]> {
  const memeParticipants = loadMemeParticipants();
  const supabase = getSupabaseClient();
  if (!supabase) return [...loadYamlParticipants(), ...memeParticipants];

  const { data, error } = await supabase
    .from("participants")
    .select(
      "id, name, nickname, photo, banner, age, weight, height, country, country_flag, instagram_handle, instagram_followers, x_handle, x_followers, lol_rank, lol_username, lol_server, main_role, fav_champion, description, stats, performance_rank, performance_scores, titles, mmradar_icon_url, mmradar_server"
    )
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) {
    if (error) console.warn("No se pudieron cargar participantes de Supabase:", error.message);
    return [...loadYamlParticipants(), ...memeParticipants];
  }

  const participants = data.map(toParticipant);
  const result = ParticipantListSchema.safeParse(participants);
  if (!result.success) {
    console.warn("Participantes de Supabase con formato invalido, usando YAML:", result.error.message);
    return [...loadYamlParticipants(), ...memeParticipants];
  }

  return [...result.data, ...memeParticipants];
}

/**
 * Finds the participant profile owned by a given auth user id, if any.
 * Used by /inscripcion to decide whether to show the create-profile form or
 * the edit-my-profile form. Reads with the admin client since owner_user_id
 * isn't exposed by the public read policy's selected columns by default
 * here, but mainly to keep this lookup reliable regardless of RLS changes.
 */
export async function findParticipantByOwner(
  ownerUserId: string,
  locals?: Pick<APIContext, "locals">["locals"]
): Promise<Participant | null> {
  const [admin, msg] = createSupabaseAdminClient(locals);
  if (!admin) {
    console.warn("No se pudo crear el cliente de Supabase admin:", msg);
    return null;
  }

  const { data, error } = await admin
    .from("participants")
    .select(
      "id, name, nickname, photo, banner, age, weight, height, country, country_flag, instagram_handle, instagram_followers, x_handle, x_followers, lol_rank, lol_username, lol_server, main_role, fav_champion, description, stats, performance_rank, performance_scores, titles, mmradar_icon_url, mmradar_server"
    )
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (error || !data) return null;

  const parsed = ParticipantSchema.safeParse(toParticipant(data));
  return parsed.success ? parsed.data : null;
}
