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
const TIER_THRESHOLDS: { tier: RankTier; minTotal: number }[] = [
  { tier: "Iron", minTotal: 0 },
  { tier: "Bronze", minTotal: 7500 },
  { tier: "Silver", minTotal: 8600 },
  { tier: "Gold", minTotal: 9600 },
  { tier: "Platinum", minTotal: 10400 },
  { tier: "Emerald", minTotal: 11100 },
  { tier: "Diamond", minTotal: 11700 },
  { tier: "Master", minTotal: 12300 },
  { tier: "Grandmaster", minTotal: 12800 },
  { tier: "Challenger", minTotal: 13300 }
];

/**
 * Cuantos "escalones" (division dentro de tier, IV->I = 1 escalon cada
 * una, y de tier a tier tambien cuenta como escalones para Master+ sin
 * division) puede mover el ajuste de winrate/consistencia el tier base.
 * Es lo que explica el salto grande observado entre los 2 perfiles de
 * referencia (promedios sumados a ~200 puntos de distancia, pero uno
 * queda en Diamond y el otro en Challenger): el perfil A tiene mejor
 * Account Health (82 vs 71) y un rango oficial mucho mas alto (Challenger
 * 2794LP vs Platinum II 67LP) pese al mismo 63% de winrate reciente en
 * ambos -- el ajuste de consistencia (bajo Account Health = rendimiento
 * mas erratico partida a partida) es lo que hace la diferencia real aca,
 * no el winrate (que es identico en los 2 ejemplos).
 */
const MAX_ADJUSTMENT_STEPS = 6;

function winRateAdjustment(winRate: number, gamesPlayed: number): number {
  if (gamesPlayed < 4) return 0;
  const centered = winRate - 0.5;
  return centered * 6; // hasta +-3 escalones
}

function consistencyAdjustment(matches: TitleEngineMatch[]): number {
  if (matches.length < 4) return 0;
  const totals = matches.map((m) => m.scores.total);
  const mean = average(totals);
  if (mean <= 0) return 0;
  const variance = average(totals.map((t) => (t - mean) ** 2));
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  const centered = 0.2 - coefficientOfVariation;
  // Reducido de +-4.5 a +-3.0 escalones máximos
  return Math.max(-3, Math.min(3, centered * 15));
}

export interface PerformanceRankResult {
  rank: string;
  tier: RankTier;
  /** 0=IV .. 3=I. Siempre 0 (sin division mostrada) para Master+. */
  divisionIndex: number;
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

export const PERFORMANCE_RANK_EXPLANATION = {
  title: "¿Cómo se calcula el Performance Rank?",
  summary:
    "Se basa en el promedio y consistencia de tus últimas partidas, con ajustes por winrate y estabilidad de rendimiento.",
  formula: "Rango base (por tu promedio) + ajuste por winrate + ajuste por consistencia",
  points: [
    "Promedio: se suman tus 6 scores (Laning, Farming, Objectives, Combat, Teamfight, Vision) de cada partida y se promedia sobre tus últimas partidas",
    "Winrate: ganar seguido te sube de rango, perder seguido te baja. Hace falta un mínimo de partidas para que esto pese.",
    "Consistencia: rendir parecido partida a partida (sin picos ni bajones grandes) suma; ser errático resta.",
    "Con promedios muy parecidos, dos jugadores pueden terminar en rangos distintos si uno gana más seguido o juega más parejo que el otro"
  ]
};