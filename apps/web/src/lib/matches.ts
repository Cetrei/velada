import { getSupabaseClient } from "./supabase";
import type { JudgeCard, Match, PredictionTally } from "@velada/core";

interface MatchRow {
  id: string;
  match_number: number | null;
  name: string | null;
  player1_id: string;
  player2_id: string;
  winner_id: string | null;
  decision: string | null;
  judge_cards: JudgeCard[] | null;
  predictions_open: boolean;
  is_random: boolean;
  created_at: string;
}

function toMatch(row: MatchRow): Match {
  return {
    id: row.id,
    matchNumber: row.match_number ?? undefined,
    name: row.name,
    player1Id: row.player1_id,
    player2Id: row.player2_id,
    winnerId: row.winner_id,
    decision: row.decision,
    judgeCards: row.judge_cards,
    predictionsOpen: row.predictions_open,
    isRandom: row.is_random,
    createdAt: row.created_at
  };
}

/** All matches, oldest first (match_number when set, otherwise creation order). Empty array when Supabase isn't configured. */
export async function fetchMatches(): Promise<Match[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("matches")
    .select(
      "id, match_number, name, player1_id, player2_id, winner_id, decision, judge_cards, predictions_open, is_random, created_at"
    )
    .order("match_number", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error || !data) {
    console.warn("No se pudieron cargar los combates:", error?.message);
    return [];
  }

  return data.map(toMatch);
}

/** Matches that already have an official winner_id. */
export function withOfficialResult(matches: Match[]): Match[] {
  return matches.filter((m) => m.winnerId);
}

/** Matches open for community predictions and without an official result yet. */
export function openForPredictions(matches: Match[]): Match[] {
  return matches.filter((m) => m.predictionsOpen && !m.winnerId);
}

/**
 * Vote counts per match, computed server-side from the raw predictions table
 * so results can't be spoofed by trusting a client-supplied tally. Needs the
 * matches themselves (not just their ids) to know which id is "player1" vs
 * "player2" for each match.
 */
export async function fetchPredictionTallies(matches: Match[]): Promise<Map<string, PredictionTally>> {
  const tallies = new Map<string, PredictionTally>();
  if (matches.length === 0) return tallies;

  const supabase = getSupabaseClient();
  if (!supabase) return tallies;

  const matchIds = matches.map((m) => m.id).filter((id): id is string => Boolean(id));
  if (matchIds.length === 0) return tallies;

  const { data, error } = await supabase
    .from("predictions")
    .select("match_id, predicted_winner_id")
    .in("match_id", matchIds);

  if (error || !data) {
    console.warn("No se pudieron cargar los pronosticos:", error?.message);
    return tallies;
  }

  const matchById = new Map(matches.map((m) => [m.id, m]));

  for (const match of matches) {
    if (!match.id) continue;
    tallies.set(match.id, { matchId: match.id, player1Votes: 0, player2Votes: 0, totalVotes: 0 });
  }

  for (const row of data) {
    const match = matchById.get(row.match_id);
    const tally = tallies.get(row.match_id);
    if (!match || !tally) continue;

    tally.totalVotes += 1;
    if (row.predicted_winner_id === match.player1Id) {
      tally.player1Votes += 1;
    } else if (row.predicted_winner_id === match.player2Id) {
      tally.player2Votes += 1;
    }
  }

  return tallies;
}

/**
 * Total prediction votes received per participant, across every match they
 * were predicted to win — used to sort the roster explorer by popularity.
 */
export async function fetchVotesByParticipant(): Promise<Record<string, number>> {
  const supabase = getSupabaseClient();
  if (!supabase) return {};

  const { data, error } = await supabase.from("predictions").select("predicted_winner_id");
  if (error || !data) {
    console.warn("No se pudieron cargar los votos por participante:", error?.message);
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data) {
    counts[row.predicted_winner_id] = (counts[row.predicted_winner_id] ?? 0) + 1;
  }
  return counts;
}
