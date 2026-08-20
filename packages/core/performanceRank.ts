import { RANK_TIERS, type RankTier } from "./rankIcon";
import type { MmradarPerformanceScores } from "./mmradarScraper";
import type { TitleEngineMatch } from "./titleEngine";

const SCORE_KEYS: (keyof MmradarPerformanceScores)[] = [
  "laning",
  "farming",
  "objectives",
  "combat",
  "teamfight",
  "vision"
];

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function totalOf(scores: MmradarPerformanceScores): number {
  return SCORE_KEYS.reduce((sum, key) => sum + scores[key], 0);
}

/**
 * Umbrales base centrados.
 * Esto coloca las puntuaciones base en un punto neutral:
 * - ~9822 (Sovietic) entra en Oro II.
 * - ~10057 (YourDaddy) entra justo en Oro I.
 * - ~10455 (Nashi) entra en Platino III.
 * - ~10564 (LegenPaPa) entra en Platino II.
 * Los saltos finales (Sovietic subiendo a Plat I y LegenPaPa cayendo a Oro III)
 * dependerán 100% de los ajustes de abajo.
 */
const TIER_THRESHOLDS: { tier: RankTier; minTotal: number }[] = [
  { tier: "Iron", minTotal: 0 },
  { tier: "Bronze", minTotal: 7000 },
  { tier: "Silver", minTotal: 8200 },
  { tier: "Gold", minTotal: 9200 },
  { tier: "Platinum", minTotal: 10200 },
  { tier: "Emerald", minTotal: 10800 },
  { tier: "Diamond", minTotal: 11300 },
  { tier: "Master", minTotal: 11600 },
  { tier: "Grandmaster", minTotal: 11800 },
  { tier: "Challenger", minTotal: 12000 }
];

const MAX_ADJUSTMENT_STEPS = 6;

/**
 * Multiplicador aumentado. Un winrate extremo (ej. 70%) ahora aporta
 * hasta +2.4 escalones, y uno malo (ej. 35%) resta -1.2 escalones.
 */
function winRateAdjustment(winRate: number, gamesPlayed: number): number {
  if (gamesPlayed < 4) return 0;
  const centered = winRate - 0.5; // -0.5..0.5
  return centered * 8; // Max +-4 escalones en casos 100% / 0%
}

/**
 * Multiplicador de consistencia re-calibrado.
 * Es el principal responsable de separar puntajes idénticos.
 */
function consistencyAdjustment(matches: TitleEngineMatch[]): number {
  if (matches.length < 4) return 0;
  const totals = matches.map((m) => m.scores.total);
  const mean = average(totals);
  if (mean <= 0) return 0;
  const variance = average(totals.map((t) => (t - mean) ** 2));
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  const centered = 0.2 - coefficientOfVariation; 
  // Multiplicador agresivo: perfiles muy constantes suben rápido, erráticos caen fuerte.
  return Math.max(-4, Math.min(4, centered * 20)); 
}

export interface PerformanceRankResult {
  rank: string;
  tier: RankTier;
  divisionIndex: number;
}

/**
 * Desglose completo del calculo, pensado para calibracion (ver
 * scripts/test-rank-calibration.test.ts). Nunca se usa en el pipeline real
 * de la app -- computePerformanceRank ya devuelve lo unico que se persiste.
 */
export interface PerformanceRankDebug {
  gamesPlayed: number;
  avgTotal: number;
  winRate: number;
  wins: number;
  baseTierIndex: number;
  baseTierLabel: RankTier;
  fractionalInTier: number;
  totalSteps: number;
  winRateAdjustment: number;
  consistencyAdjustment: number;
  rawAdjustment: number;
  clampedAdjustment: number;
  finalSteps: number;
  result: PerformanceRankResult | null;
}

export function computePerformanceRank(matches: TitleEngineMatch[]): PerformanceRankResult | null {
  if (matches.length === 0) return null;

  const totals = matches.map((m) => m.scores.total);
  const avgTotal = average(totals);
  const wins = matches.filter((m) => m.won).length;
  const winRate = matches.length > 0 ? wins / matches.length : 0;

  let baseTierIndex = 0;
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (avgTotal >= TIER_THRESHOLDS[i].minTotal) {
      baseTierIndex = i;
      break;
    }
  }

  const currentMin = TIER_THRESHOLDS[baseTierIndex].minTotal;
  const nextMin = TIER_THRESHOLDS[baseTierIndex + 1]?.minTotal ?? currentMin + 600;
  const fractionalInTier = Math.max(0, Math.min(1, (avgTotal - currentMin) / (nextMin - currentMin)));

  const totalSteps = baseTierIndex * 4 + Math.round(fractionalInTier * 3);

  const adjustment = winRateAdjustment(winRate, matches.length) + consistencyAdjustment(matches);
  const clampedAdjustment = Math.max(-MAX_ADJUSTMENT_STEPS, Math.min(MAX_ADJUSTMENT_STEPS, adjustment));

  const finalSteps = Math.max(0, Math.min(RANK_TIERS.length * 4 - 1, totalSteps + Math.round(clampedAdjustment)));

  const finalTierIndex = Math.min(RANK_TIERS.length - 1, Math.floor(finalSteps / 4));
  const finalDivisionIndex = Math.min(3, finalSteps % 4);
  const tier = RANK_TIERS[finalTierIndex];

  const divisionLabels = ["IV", "III", "II", "I"];
  const hasDivisions = tier !== "Master" && tier !== "Grandmaster" && tier !== "Challenger";
  const rank = hasDivisions ? `${tier} ${divisionLabels[finalDivisionIndex]}` : tier;

  return { rank, tier, divisionIndex: finalDivisionIndex };
}

/**
 * Misma logica que computePerformanceRank, pero devolviendo cada numero
 * intermedio en vez de solo el resultado final -- para poder ver, jugador
 * por jugador, por que el motor dio el rango que dio y ajustar las
 * constantes de arriba (TIER_THRESHOLDS, multiplicadores de
 * winRateAdjustment/consistencyAdjustment) con datos reales delante en vez
 * de a ciegas. No se usa en el pipeline real de la app.
 */
export function computePerformanceRankDebug(matches: TitleEngineMatch[]): PerformanceRankDebug | null {
  if (matches.length === 0) return null;

  const totals = matches.map((m) => m.scores.total);
  const avgTotal = average(totals);
  const wins = matches.filter((m) => m.won).length;
  const winRate = matches.length > 0 ? wins / matches.length : 0;

  let baseTierIndex = 0;
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (avgTotal >= TIER_THRESHOLDS[i].minTotal) {
      baseTierIndex = i;
      break;
    }
  }

  const currentMin = TIER_THRESHOLDS[baseTierIndex].minTotal;
  const nextMin = TIER_THRESHOLDS[baseTierIndex + 1]?.minTotal ?? currentMin + 600;
  const fractionalInTier = Math.max(0, Math.min(1, (avgTotal - currentMin) / (nextMin - currentMin)));

  const totalSteps = baseTierIndex * 4 + Math.round(fractionalInTier * 3);

  const wrAdj = winRateAdjustment(winRate, matches.length);
  const consAdj = consistencyAdjustment(matches);
  const rawAdjustment = wrAdj + consAdj;
  const clampedAdjustment = Math.max(-MAX_ADJUSTMENT_STEPS, Math.min(MAX_ADJUSTMENT_STEPS, rawAdjustment));

  const finalSteps = Math.max(0, Math.min(RANK_TIERS.length * 4 - 1, totalSteps + Math.round(clampedAdjustment)));

  return {
    gamesPlayed: matches.length,
    avgTotal,
    winRate,
    wins,
    baseTierIndex,
    baseTierLabel: TIER_THRESHOLDS[baseTierIndex].tier,
    fractionalInTier,
    totalSteps,
    winRateAdjustment: wrAdj,
    consistencyAdjustment: consAdj,
    rawAdjustment,
    clampedAdjustment,
    finalSteps,
    result: computePerformanceRank(matches)
  };
}

export const PERFORMANCE_RANK_EXPLANATION = {
  title: "¿Cómo se calcula el Performance Rank?",
  summary:
    "Se basa en el promedio de tus últimas partidas, fuertemente condicionado por tu winrate y tu constancia.",
  formula: "Rango base (por promedio) + fuerte ajuste por winrate y consistencia",
  points: [
    "Promedio Base: Tu suma total te coloca en un rango inicial neutral.",
    "Ajuste decisivo: Dos jugadores con el mismo puntaje base pueden terminar con ligas muy distintas. Jugar de forma consistente y mantener buen winrate te sube divisiones enteras, ser errático te las quita."
  ]
};