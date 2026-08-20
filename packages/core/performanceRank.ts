/**
 * Performance Rank PROPIO de este proyecto (no el de mmradar.gg).
 *
 * Por que existe: mmradar.gg calcula su propio "Performance Rank" (ej.
 * "Emerald IV", "Challenger") pero lo pinta 100% con JS del lado del
 * cliente -- confirmado por el usuario y por el HTML real inspeccionado
 * en mmradarScraper.ts (parsePerformanceRank): ese tier NUNCA aparece en
 * el HTML servidor que fetch() puede leer, asi que no hay forma de
 * consultarlo de verdad desde este proyecto (Cloudflare Workers, sin
 * navegador headless).
 *
 * Ademas, el usuario confirmo con datos reales de su propia cuenta de
 * mmradar que el tier de mmradar NO es una funcion simple del promedio
 * total: un perfil con promedio 1860 aparecia como "Emerald IV" y otro
 * con promedio ~1894 (34 puntos mas, casi identico) aparecia como
 * "Challenger" -- el tier mas alto posible. Eso descarta un corte lineal
 * fijo sobre el promedio; tiene que estar pesando algo mas (winrate,
 * consistencia, LP, comparacion contra la poblacion de jugadores, etc.)
 * que este proyecto no puede ver ni replicar exactamente.
 *
 * Decision del usuario (2026-08-20): en vez de perseguir una formula que
 * no se puede observar, se calcula un Performance Rank PROPIO usando los
 * mismos datos crudos que ya se consultan aca (ver fetchRawMatches en
 * mmradarScraper.ts) -- promedio total, winrate, y consistencia
 * (desviacion estandar) de las ultimas partidas. No pretende replicar el
 * numero exacto de mmradar, solo dar una seña razonable y explicable con
 * la misma forma de tier+division que ya usa el resto del sitio.
 */

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
 * Umbrales de promedio TOTAL (suma de los 6 stats, escala real ~1200-2500
 * segun ejemplos reales del usuario) para el tier BASE, antes de aplicar
 * los ajustes de winrate/consistencia. Elegidos a ojo repartiendo el
 * rango observado (partidas individuales entre ~1300 y ~2400,
 * promedios de perfil alrededor de 1800-1900 para Emerald/Diamond/
 * Challenger segun mmradar) en 10 escalones, dejando mas margen arriba
 * para Master+ (elo real de LoL tambien se angosta ahi, muy pocos
 * jugadores). No representan ningun corte oficial de mmradar ni de Riot
 * -- es el criterio propio de este proyecto, ajustable libremente sin
 * tocar el resto del calculo.
 */
const TIER_THRESHOLDS: { tier: RankTier; minTotal: number }[] = [
  { tier: "Iron", minTotal: 0 },
  { tier: "Bronze", minTotal: 900 },
  { tier: "Silver", minTotal: 1100 },
  { tier: "Gold", minTotal: 1300 },
  { tier: "Platinum", minTotal: 1500 },
  { tier: "Emerald", minTotal: 1650 },
  { tier: "Diamond", minTotal: 1800 },
  { tier: "Master", minTotal: 1950 },
  { tier: "Grandmaster", minTotal: 2100 },
  { tier: "Challenger", minTotal: 2250 }
];

/**
 * Cuantos "escalones" (division dentro de tier, IV->I = 1 escalon cada
 * una, y de tier a tier tambien cuenta como escalones para Master+ sin
 * division) puede mover el ajuste de winrate/consistencia el tier base.
 * Es lo que explica el salto grande que reporto el usuario (1860 ->
 * Emerald IV vs 1894 -> Challenger, con el mismo promedio casi identico):
 * si esa otra cuenta tiene mejor winrate y/o rinde mas parejo partida a
 * partida, el ajuste la empuja varios escalones arriba del tier base que
 * le tocaria solo por promedio.
 */
const MAX_ADJUSTMENT_STEPS = 6;

/**
 * Bono/penalidad por winrate, en escalones. >=70% empuja fuerte hacia
 * arriba, <=35% empuja fuerte hacia abajo -- simetrico alrededor de 50%
 * como punto neutro. Requiere un minimo de partidas para no dejar que un
 * 2/2 (100% winrate) mueva el tier tanto como un 14/20 real.
 */
function winRateAdjustment(winRate: number, gamesPlayed: number): number {
  if (gamesPlayed < 4) return 0;
  const centered = winRate - 0.5; // -0.5..0.5
  return centered * 6; // hasta +-3 escalones en los extremos
}

/**
 * Bono/penalidad por consistencia: coeficiente de variacion (desviacion
 * estandar / promedio) de los totals de cada partida. Bajo = rendis
 * parecido siempre (bono), alto = rendimiento errático (penalidad). Mismo
 * calculo de dispersion relativa que ya usa el titulo "Consistente" en
 * titleEngine.ts, reusado aca con su propio umbral/escala.
 */
function consistencyAdjustment(matches: TitleEngineMatch[]): number {
  if (matches.length < 4) return 0;
  const totals = matches.map((m) => m.scores.total);
  const mean = average(totals);
  if (mean <= 0) return 0;
  const variance = average(totals.map((t) => (t - mean) ** 2));
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  // 0.10 (muy consistente) -> +1.5 escalones; 0.35+ (muy erratico) -> -1.5
  const centered = 0.2 - coefficientOfVariation; // positivo = mas consistente que el punto neutro
  return Math.max(-1.5, Math.min(1.5, centered * 7));
}

export interface PerformanceRankResult {
  rank: string;
  tier: RankTier;
  /** 0=IV .. 3=I. Siempre 0 (sin division mostrada) para Master+. */
  divisionIndex: number;
}

/**
 * Calcula el Performance Rank propio a partir de las partidas crudas
 * (mismo shape que ya arma fetchRawMatches en mmradarScraper.ts). null si
 * no hay partidas suficientes para un calculo con sentido.
 */
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

  // Posicion fraccionaria dentro del tier base (0=recien entrado, 1=a punto
  // de subir), para que el ajuste no siempre parta del mismo punto medio
  // de cada tier.
  const currentMin = TIER_THRESHOLDS[baseTierIndex].minTotal;
  const nextMin = TIER_THRESHOLDS[baseTierIndex + 1]?.minTotal ?? currentMin + 200;
  const fractionalInTier = Math.max(0, Math.min(1, (avgTotal - currentMin) / (nextMin - currentMin)));

  // Escalones totales: 4 por tier (divisiones IV..I), Master+ sin division
  // real pero se le sigue dando 4 "escalones virtuales" para que el
  // ajuste tenga el mismo rango de movimiento ahi tambien.
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
