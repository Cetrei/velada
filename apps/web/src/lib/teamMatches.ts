import { getSupabaseClient } from "./supabase";
import type { TeamMatch, TeamPredictionTally } from "@velada/core";

interface TeamMatchRow {
  id: string;
  name: string | null;
  team_a_ids: string[];
  team_b_ids: string[];
  winner_team: "A" | "B" | null;
  generation_mode: TeamMatch["generationMode"];
  predictions_open: boolean;
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
    predictionsOpen: row.predictions_open,
    createdAt: row.created_at
  };
}

/** Todos los team matches, mas nuevos primero. Vacio si Supabase no esta configurado. */
export async function fetchTeamMatches(): Promise<TeamMatch[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("team_matches")
    .select("id, name, team_a_ids, team_b_ids, winner_team, generation_mode, predictions_open, created_at")
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.warn("No se pudieron cargar los combates por equipos:", error?.message);
    return [];
  }

  return data.map(toTeamMatch);
}

/** Team matches abiertos a pronostico de la comunidad y sin resultado oficial aun. */
export function openForTeamPredictions(teamMatches: TeamMatch[]): TeamMatch[] {
  return teamMatches.filter((tm) => tm.predictionsOpen && !tm.winnerTeam);
}

/**
 * Conteo de votos por team match, calculado server-side desde la tabla
 * cruda para que no se pueda falsear desde el cliente. Mismo patron que
 * fetchPredictionTallies en matches.ts, pero contando por equipo (A/B) en
 * vez de por jugador individual.
 */
export async function fetchTeamPredictionTallies(teamMatches: TeamMatch[]): Promise<Map<string, TeamPredictionTally>> {
  const tallies = new Map<string, TeamPredictionTally>();
  if (teamMatches.length === 0) return tallies;

  const supabase = getSupabaseClient();
  if (!supabase) return tallies;

  const teamMatchIds = teamMatches.map((tm) => tm.id).filter((id): id is string => Boolean(id));
  if (teamMatchIds.length === 0) return tallies;

  const { data, error } = await supabase
    .from("team_predictions")
    .select("team_match_id, predicted_winner_team")
    .in("team_match_id", teamMatchIds);

  if (error || !data) {
    console.warn("No se pudieron cargar los pronosticos por equipo:", error?.message);
    return tallies;
  }

  for (const tm of teamMatches) {
    if (!tm.id) continue;
    tallies.set(tm.id, { teamMatchId: tm.id, teamAVotes: 0, teamBVotes: 0, totalVotes: 0 });
  }

  for (const row of data) {
    const tally = tallies.get(row.team_match_id);
    if (!tally) continue;

    tally.totalVotes += 1;
    if (row.predicted_winner_team === "A") {
      tally.teamAVotes += 1;
    } else if (row.predicted_winner_team === "B") {
      tally.teamBVotes += 1;
    }
  }

  return tallies;
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
