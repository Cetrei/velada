/**
 * Convierte los datos de habilidad disponibles para un participante (los 6
 * scores de mmradar, o a falta de eso su lolRank de liga) en un unico
 * numero de "skill rating" comparable entre todos los participantes, que
 * es lo que el balanceador de equipos (teamBalancer.ts) usa para armar
 * equipos parejos o desparejos.
 *
 * Por que mediana y no promedio: un participante puede tener un score muy
 * bajo en un solo stat (ej. Vision en un ADC agresivo) que no representa
 * su nivel general — la media dejaria que ese unico valor arrastre el
 * numero final hacia abajo. La mediana es la medida de tendencia central
 * estandar para esto: es robusta a outliers por definicion (no descarta
 * datos como un promedio recortado, que con solo 6 valores es inestable —
 * descartar 2 de 6 es descartar un tercio de la muestra), y no asume nada
 * sobre la forma de la distribucion subyacente.
 */

import { RANK_TIERS, rankTierOf, type RankTier } from "./rankIcon";
import type { MmradarPerformanceScores } from "./mmradarScraper";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Mediana de los 6 scores de mmradar (laning/farming/objectives/combat/
 * teamfight/vision), en la misma escala 0-100(ish) en la que mmradar los
 * reporta.
 */
export function skillRatingFromPerformanceScores(scores: MmradarPerformanceScores): number {
  return median([
    scores.laning,
    scores.farming,
    scores.objectives,
    scores.combat,
    scores.teamfight,
    scores.vision
  ]);
}

/**
 * Division dentro de un tier, mapeada a 0-3 (IV=0 ... I=3) para el
 * fallback numerico. Master+ no tiene division (1v1 elo puro): se trata
 * como "division 0" ya que el tier en si mismo ya es la senal fuerte ahi.
 */
function divisionValue(lolRank: string): number {
  const match = lolRank.match(/\b(I{1,3}|IV)\b\s*$/);
  if (!match) return 0;
  switch (match[1]) {
    case "IV":
      return 0;
    case "III":
      return 1;
    case "II":
      return 2;
    case "I":
      return 3;
    default:
      return 0;
  }
}

/**
 * Fallback numerico cuando no hay datos de mmradar para un participante:
 * convierte su lolRank de liga (ej. "Diamond II") a un numero en una
 * escala comparable a la mediana de performance scores (0-100), para que
 * el balanceador pueda mezclar participantes con y sin datos de mmradar
 * en el mismo calculo sin que unos pesen artificialmente mas que otros.
 *
 * Escala: cada tier ocupa un bloque de 10 puntos (Iron=0-10, Bronze=10-20,
 * ..., Challenger=90-100), y la division dentro del tier reparte esos 10
 * puntos en cuartos segun divisionValue. Es una aproximacion deliberada
 * (no hay LP exacto para todos los jugadores), pensada solo para ordenar
 * relativamente a los participantes sin datos de mmradar entre si y
 * frente a los que si tienen datos, no como metrica precisa de MMR real.
 */
export function skillRatingFromLolRank(lolRank: string | null | undefined): number {
  const tier = rankTierOf(lolRank);
  if (!tier) return 0;

  const tierIndex = RANK_TIERS.indexOf(tier as RankTier);
  const tierBase = tierIndex * 10;
  const divisionBonus = divisionValue(lolRank ?? "") * 2.5;

  return tierBase + divisionBonus;
}

export interface SkillRatingInput {
  performanceScores?: MmradarPerformanceScores | null;
  lolRank?: string | null;
}

/**
 * Fuente unica de verdad del skill rating de un participante para el
 * balanceador de equipos: mediana de mmradar si hay datos, si no el
 * fallback jerarquico basado en lolRank.
 */
export function computeSkillRating(input: SkillRatingInput): number {
  if (input.performanceScores) {
    return skillRatingFromPerformanceScores(input.performanceScores);
  }
  return skillRatingFromLolRank(input.lolRank);
}
