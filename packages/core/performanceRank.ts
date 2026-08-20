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
 * Umbrales base (sin cambios respecto a la calibracion anterior).
 * IMPORTANTE (calibracion 2026-08-20, ver sesion en AGENT.md): con los 5
 * jugadores reales de scripts/rank-calibration-fixtures.json, el promedio
 * total NO predice bien el rango esperado por si solo -- confirmado con un
 * ajuste por minimos cuadrados sobre (avgTotal, winRate, coeficiente de
 * variacion) contra los escalones esperados: el peso que mejor explica los
 * datos para avgTotal es practicamente cero comparado a su escala, mientras
 * que winrate y consistencia si tienen peso real. Por eso el tier base que
 * sale de estos umbrales ahora se COMPRIME hacia un centro comun en
 * baseStepsFromAvgTotal() en vez de usarse tal cual -- el promedio sigue
 * siendo el punto de partida, pero winrate/consistencia son quienes deciden
 * la mayor parte del resultado final.
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

/**
 * Cuanto pesa el tier base (por avgTotal) en el resultado final, contra un
 * centro comun (BASE_STEPS_CENTER). 1 = el tier base pesa entero (como
 * antes). 0 = el promedio no importa nada, todo lo decide winrate +
 * consistencia. 0.2 fue el valor que mejor explico el dataset real de
 * calibracion -- el promedio total resulto ser una senal debil para separar
 * jugadores, comparado a lo que aportan winrate/consistencia.
 */
const BASE_STEPS_COMPRESSION = 0.2;
/** Centro (en escalones) hacia el que se comprime el tier base. ~17 escalones = Platino III/II, el centro del dataset real (Oro-Platino). */
const BASE_STEPS_CENTER = 17;

const MAX_ADJUSTMENT_STEPS = 8;

/**
 * Tier base por avgTotal, ya comprimido hacia BASE_STEPS_CENTER segun
 * BASE_STEPS_COMPRESSION (ver comentario de TIER_THRESHOLDS). Devuelve un
 * numero fraccionario a proposito -- solo se redondea en el resultado
 * final, para no perder precision al sumar los ajustes de winrate/
 * consistencia encima.
 */
function baseStepsFromAvgTotal(avgTotal: number): number {
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
  const rawSteps = baseTierIndex * 4 + fractionalInTier * 3;
  return rawSteps * BASE_STEPS_COMPRESSION + BASE_STEPS_CENTER * (1 - BASE_STEPS_COMPRESSION);
}

/**
 * Multiplicador re-calibrado (ver comentario de TIER_THRESHOLDS): con el
 * tier base comprimido, winrate necesita mantenerse como factor real. Un
 * winrate extremo (ej. 70%) ahora aporta hasta +1.6 escalones, y uno malo
 * (ej. 20%) resta -2.4 escalones.
 */
function winRateAdjustment(winRate: number, gamesPlayed: number): number {
  if (gamesPlayed < 4) return 0;
  const centered = winRate - 0.5; // -0.5..0.5
  return centered * 8; // Max +-4 escalones en casos 100% / 0%
}

/**
 * Multiplicador de consistencia re-calibrado (ver comentario de
 * TIER_THRESHOLDS). Con el tier base comprimido, este es ahora el factor
 * individual mas fuerte -- perfiles muy constantes (cv bajo) suben rapido,
 * erraticos (cv alto) caen fuerte.
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
  // Multiplicador mas agresivo que antes (20 -> 40): perfiles muy
  // constantes suben rapido, erraticos caen fuerte.
  return Math.max(-MAX_ADJUSTMENT_STEPS, Math.min(MAX_ADJUSTMENT_STEPS, centered * 40));
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

  const totalSteps = baseStepsFromAvgTotal(avgTotal);

  const adjustment = winRateAdjustment(winRate, matches.length) + consistencyAdjustment(matches);
  const clampedAdjustment = Math.max(-MAX_ADJUSTMENT_STEPS, Math.min(MAX_ADJUSTMENT_STEPS, adjustment));

  const finalSteps = Math.max(0, Math.min(RANK_TIERS.length * 4 - 1, Math.round(totalSteps + clampedAdjustment)));

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

  // baseTierIndex/fractionalInTier de aca abajo son SOLO informativos (para
  // el log de calibracion) -- muestran donde caeria el tier segun el
  // promedio SIN comprimir, para poder comparar contra totalSteps (que si
  // usa la version comprimida via baseStepsFromAvgTotal).
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

  const totalSteps = baseStepsFromAvgTotal(avgTotal);

  const wrAdj = winRateAdjustment(winRate, matches.length);
  const consAdj = consistencyAdjustment(matches);
  const rawAdjustment = wrAdj + consAdj;
  const clampedAdjustment = Math.max(-MAX_ADJUSTMENT_STEPS, Math.min(MAX_ADJUSTMENT_STEPS, rawAdjustment));

  const finalSteps = Math.max(0, Math.min(RANK_TIERS.length * 4 - 1, Math.round(totalSteps + clampedAdjustment)));

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