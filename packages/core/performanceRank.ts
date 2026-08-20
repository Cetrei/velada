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
 * Umbrales de promedio TOTAL (suma de 6 stats) recalibrados.
 *
 * Referencias de prueba:
 * - ~9300  (avg 1550) -> Gold IV
 * - ~10057 (avg 1676) -> Gold I / Gold II (ej. YourDaddyDrinks)
 * - ~10455 (avg 1743) -> Platinum III / II (ej. Nashi)
 * - ~10920 (avg 1820) -> Emerald IV
 * - ~11160 (avg 1860) -> Emerald I / Diamond IV
 * - ~11360 (avg 1893) -> Challenger
 */
const TIER_THRESHOLDS: { tier: RankTier; minTotal: number }[] = [
  { tier: "Iron", minTotal: 0 },
  { tier: "Bronze", minTotal: 7200 },      // avg 1200
  { tier: "Silver", minTotal: 8400 },      // avg 1400
  { tier: "Gold", minTotal: 9300 },        // avg 1550
  { tier: "Platinum", minTotal: 10200 },    // avg 1700
  { tier: "Emerald", minTotal: 10920 },    // avg 1820
  { tier: "Diamond", minTotal: 11160 },    // avg 1860
  { tier: "Master", minTotal: 11250 },     // avg 1875
  { tier: "Grandmaster", minTotal: 11325 }, // avg 1887
  { tier: "Challenger", minTotal: 11360 }   // avg 1893+
];

const MAX_ADJUSTMENT_STEPS = 2;

function winRateAdjustment(winRate: number, gamesPlayed: number): number {
  if (gamesPlayed < 4) return 0;
  const centered = winRate - 0.5; // -0.5..0.5
  return centered * 3; // hasta +-1.5 escalones
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
  return Math.max(-1.5, Math.min(1.5, centered * 10)); // hasta +-1.5 escalones
}

export interface PerformanceRankResult {
  rank: string;
  tier: RankTier;
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
    "Se basa en el promedio de tus últimas partidas, con ligeros ajustes por winrate y consistencia.",
  formula: "Rango base (por promedio) + ajuste por winrate y consistencia (máx ±2 divisiones)",
  points: [
    "Promedio: suma de tus 6 métricas individuales comparada contra los umbrales de rango.",
    "Ajustes: el winrate reciente y la estabilidad de rendimiento pueden subirte o bajarte hasta 2 divisiones como máximo."
  ]
};