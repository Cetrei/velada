import { getSupabaseClient } from "./supabase";

/**
 * Total de likes por participante, calculado server-side leyendo
 * fighter_likes directo (mismo patron que fetchPredictionTallies en
 * matches.ts) en vez de confiar en un conteo mandado por el cliente.
 * Devuelve solo los participantes con al menos un like; quien no tiene
 * ninguno simplemente no aparece en el Record (se trata como 0 en el
 * consumidor).
 */
export async function fetchLikeCounts(): Promise<Record<string, number>> {
  const supabase = getSupabaseClient();
  if (!supabase) return {};

  const { data, error } = await supabase.from("fighter_likes").select("participant_id");

  if (error || !data) {
    console.warn("No se pudieron cargar los likes:", error?.message);
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data) {
    counts[row.participant_id] = (counts[row.participant_id] ?? 0) + 1;
  }
  return counts;
}
