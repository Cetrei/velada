import { getSupabaseClient } from "./supabase";
import type { TeamMatch } from "@velada/core";

interface TeamMatchRow {
  id: string;
  name: string | null;
  team_a_ids: string[];
  team_b_ids: string[];
  winner_team: "A" | "B" | null;
  generation_mode: TeamMatch["generationMode"];
  created_at: string;
}

function toTeamMatch(row: TeamMatchRow): TeamMatch {
  return {
    id: row.id,
    name: row.name,
    teamAIds: row.team_a_ids,
    teamBIds: row.team_b_ids,
    winnerTeam: row.winner_team,
    generationMode: row.generation_mode,
    createdAt: row.created_at
  };
}

/** Todos los team matches, mas nuevos primero. Vacio si Supabase no esta configurado. */
export async function fetchTeamMatches(): Promise<TeamMatch[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("team_matches")
    .select("id, name, team_a_ids, team_b_ids, winner_team, generation_mode, created_at")
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.warn("No se pudieron cargar los combates por equipos:", error?.message);
    return [];
  }

  return data.map(toTeamMatch);
}

/**
 * Ids de participantes que ya estan en algun team match (con o sin
 * resultado -- ver decision del usuario: la exclusion no es automatica
 * por resultado pendiente, es solo la base para que el admin marque a
 * mano antes de generar). Usado para pre-marcar el checklist de
 * exclusion en el panel.
 */
export function participantIdsInTeamMatches(teamMatches: TeamMatch[]): Set<string> {
  const ids = new Set<string>();
  for (const tm of teamMatches) {
    for (const id of tm.teamAIds) ids.add(id);
    for (const id of tm.teamBIds) ids.add(id);
  }
  return ids;
}
