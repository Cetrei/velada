import { RANK_TIERS, rankTierOf, type RankTier } from "./rankIcon";
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
 * =============================================================================
 * REDISEÑO 2026-08-20 (2) -- sesgo negativo fijo, avgTotal descartado como
 * predictor. Ver AGENT.md / conversacion con el usuario ese dia. LEER ESTO
 * ANTES DE TOCAR CUALQUIER CONSTANTE.
 * =============================================================================
 *
 * Historia: la version anterior de este archivo (rediseño (1), mismo dia)
 * ya habia adoptado el Current Rank como ancla, y desviaba desde ahi con
 * avgTotal + winrate + consistencia. Con los 9 fixtures reales de
 * scripts/rank-calibration-fixtures.json (currentRank vs Performance Rank
 * esperado) se corrio una regresion lineal simple (desviacion = a +
 * b*avgTotal_centrado + c*winRate_centrado + d*consistencia_centrada) antes
 * de tocar nada: el fit fue debil (residual std ~1.65 escalones sobre un
 * rango de -4 a +1) y ninguna variable individual correlaciono fuerte por
 * separado (todas |r| < 0.4, incluido avgTotal, con signo hasta
 * contraintuitivo en algunos casos). Con 9 puntos y ruido de ese tamaño,
 * forzar una formula multivariable ajustada de mas hubiera sido
 * sobreajustar ruido -- lo que ya le habia pasado a la version anterior con
 * umbrales absolutos.
 *
 * Lo que SI mostraron los 9 datos con claridad: el Performance Rank casi
 * siempre es igual o levemente MENOR al Current Rank (7 de 9 desviaciones
 * son negativas o cero; las 2 excepciones son +1, nunca mas). Tiene
 * sentido logico: la mayoria de la gente no puede estar sistematicamente
 * por encima de la mediana de su propio lobby (es matematicamente
 * imposible que la mayoria supere a la mediana), asi que el Performance
 * Rank de la mayoria deberia quedar en o por debajo del Current Rank,
 * salvo para quienes de verdad "carryan" consistentemente.
 *
 * DECISION EXPLICITA DEL USUARIO (confirmada en el chat, no asumida): ante
 * la falta de señal limpia, en vez de perseguir precision exacta jugador
 * por jugador, usar un modelo simple -- casi siempre restar 1-2 escalones
 * del Current Rank, con un ajuste pequeño y acotado por winrate/
 * consistencia (las dos variables con algo de señal, aunque debil), SIN
 * pretender exactitud. avgTotal se saca del calculo por completo: no
 * aporto señal limpia y ya esta contaminado por el elo del lobby en el que
 * se jugo cada partida (mismo razonamiento del rediseño (1) sobre por que
 * un umbral absoluto de avgTotal no puede funcionar).
 *
 * ESTADO DE CALIBRACION: FIXED_BIAS_STEPS = -1.5 es la media de las 9
 * desviaciones observadas (-1.33), redondeada a un valor prolijo. Sigue
 * siendo un punto de partida razonable, no un resultado final -- correr
 * `bun run calibrate:rank` con mas jugadores reales cargados y reajustar
 * si el sesgo no se siente calibrado.
 */

/**
 * Sesgo fijo, en escalones, restado del Current Rank para llegar al
 * Performance Rank -- ver bloque de comentarios de arriba. Negativo a
 * proposito: el Performance Rank de la mayoria de los jugadores esta en o
 * por debajo de su Current Rank, nunca sistematicamente por encima.
 */
const FIXED_BIAS_STEPS = -1.5;

const MAX_ADJUSTMENT_STEPS = 4;

/**
 * Escalon absoluto (0 = Iron IV, ... ver RANK_TIERS) de un rango tipo
 * "Gold II". null si el string no matchea ningun tier conocido -- el
 * caller decide el fallback (normalmente NEUTRAL_STEPS_FALLBACK).
 */
function stepsFromRankString(rank: string | null | undefined): number | null {
  const tier = rankTierOf(rank);
  if (!tier) return null;
  const tierIndex = RANK_TIERS.indexOf(tier);

  const divisionMatch = (rank ?? "").trim().match(/\b(I{1,3}|IV)\b\s*$/);
  const divisionLabels = ["IV", "III", "II", "I"];
  const divisionIndex = divisionMatch ? divisionLabels.indexOf(divisionMatch[1]) : 0;
  // Master/Grandmaster/Challenger no tienen divisiones -- tratarlos como
  // "division I" (el tope de su propio escalon) para que la aritmetica de
  // pasos seguidos siga siendo consistente con el resto de la escala.
  const effectiveDivisionIndex = divisionMatch ? Math.max(0, divisionIndex) : 3;

  return tierIndex * 4 + effectiveDivisionIndex;
}

/**
 * Ancla en escalones si no hay Current Rank disponible (cuenta nueva,
 * unranked, o parseCurrentRank no encontro nada). Centro de la escala
 * completa de RANK_TIERS -- ni castiga ni favorece a un jugador del que no
 * sabemos nada todavia.
 */
const NEUTRAL_STEPS_FALLBACK = Math.floor((RANK_TIERS.length * 4) / 2);

/**
 * Cuanto desvia el winrate el Performance Rank respecto al sesgo fijo, en
 * escalones -- ajuste chico y acotado, nunca el factor dominante (ver
 * bloque de comentarios de arriba: winrate tenia algo de señal en los 9
 * fixtures, pero debil, no como para pesar fuerte). Maximo +-1.5 escalones
 * en los extremos (100%/0% con muestra suficiente).
 */
function winRateAdjustment(winRate: number, gamesPlayed: number): number {
  if (gamesPlayed < 4) return 0;
  const centered = winRate - 0.5; // -0.5..0.5
  return centered * 3; // Max +-1.5 escalones en casos 100% / 0%
}

/**
 * Cuanto desvia la consistencia (que tan parejo jugo entre partidas) el
 * Performance Rank respecto al sesgo fijo, en escalones -- mismo criterio
 * acotado que winRateAdjustment. Jugar mas parejo que el coeficiente de
 * variacion "neutral" (0.2) suma hasta +1.5 escalones; jugar muy erratico
 * resta hasta -1.5.
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
  return Math.max(-1.5, Math.min(1.5, centered * 7.5));
}

/**
 * Cuanto desvia el "carry" el Performance Rank respecto al sesgo fijo, en
 * escalones. Pedido explicito del usuario tras ver 1/9 en la calibracion
 * anterior: avgTotal/winrate/consistencia no distinguen "gano el equipo
 * gracias a el" de "el equipo gano a pesar de el" (o el equivalente en
 * derrota) -- dos partidas con el mismo resultado (won=true) pueden ser
 * muy distintas si el jugador aporto el 35% del total de su equipo o el
 * 12%. Usa teamShare (ver TitleEngineMatch): fraccion del total combinado
 * de su EQUIPO de 5 que aporto el jugador, 0.2 = aporte parejo.
 *
 * Señal direccional, no solo de magnitud: carryar victorias (teamShare
 * alto CON won=true) es la evidencia mas fuerte de que el jugador esta
 * mejor que su Current Rank -- suma. Cargar derrotas (teamShare BAJO con
 * won=false, el jugador aporto poco en una partida que se perdio) es la
 * evidencia mas fuerte de lo contrario -- resta. Carryar una derrota
 * (aporto mucho pero igual perdieron, mala suerte de equipo) o cargar una
 * victoria (aporto poco pero el equipo gano igual, buena suerte de
 * equipo) son ambiguas a proposito y no ajustan nada -- no es culpa ni
 * merito claro del jugador individual.
 */
function carryAdjustment(matches: TitleEngineMatch[]): number {
  const withTeamShare = matches.filter((m) => m.teamShare !== null);
  if (withTeamShare.length < 4) return 0;

  const EVEN_SHARE = 0.2; // 1/5 -- aporte parejo entre los 5 del equipo
  const CARRY_THRESHOLD = 0.26; // aporto notablemente mas que sus 4 companeros
  const CARRIED_THRESHOLD = 0.15; // aporto notablemente menos que sus 4 companeros

  let signal = 0;
  let signalCount = 0;
  for (const m of withTeamShare) {
    const share = m.teamShare as number;
    if (m.won && share >= CARRY_THRESHOLD) {
      signal += share - EVEN_SHARE; // gano cargando -- suma
      signalCount += 1;
    } else if (!m.won && share <= CARRIED_THRESHOLD) {
      signal += share - EVEN_SHARE; // perdio sin aportar -- resta (share - EVEN_SHARE ya es negativo)
      signalCount += 1;
    }
    // carry en derrota / cargado en victoria: ambiguo, no suma señal.
  }
  if (signalCount === 0) return 0;

  const avgSignal = signal / signalCount; // tipicamente entre -0.2 y +0.2
  return Math.max(-1.5, Math.min(1.5, avgSignal * 15));
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
  /** Rango real usado como ancla (input de computePerformanceRank), o null si no habia. */
  currentRank: string | null;
  /** Escalon de currentRank, o NEUTRAL_STEPS_FALLBACK si currentRank era null/no reconocido. */
  anchorSteps: number;
  fixedBiasSteps: number;
  winRateAdjustment: number;
  consistencyAdjustment: number;
  carryAdjustment: number;
  rawAdjustment: number;
  clampedAdjustment: number;
  finalSteps: number;
  result: PerformanceRankResult | null;
}

function stepsToResult(finalSteps: number): PerformanceRankResult {
  const clampedSteps = Math.max(0, Math.min(RANK_TIERS.length * 4 - 1, finalSteps));
  const finalTierIndex = Math.min(RANK_TIERS.length - 1, Math.floor(clampedSteps / 4));
  const finalDivisionIndex = Math.min(3, clampedSteps % 4);
  const tier = RANK_TIERS[finalTierIndex];

  const divisionLabels = ["IV", "III", "II", "I"];
  const hasDivisions = tier !== "Master" && tier !== "Grandmaster" && tier !== "Challenger";
  const rank = hasDivisions ? `${tier} ${divisionLabels[finalDivisionIndex]}` : tier;

  return { rank, tier, divisionIndex: finalDivisionIndex };
}

/**
 * currentRank es el Current Rank oficial (Riot) del jugador, tal como lo
 * devuelve parseCurrentRank en mmradarScraper.ts (ej. "Gold II") -- se usa
 * como ancla de partida (ver bloque de comentarios arriba). Si es null
 * (cuenta nueva, unranked, o no se pudo scrapear) se usa
 * NEUTRAL_STEPS_FALLBACK, el centro de la escala completa.
 */
export function computePerformanceRank(
  matches: TitleEngineMatch[],
  currentRank: string | null = null
): PerformanceRankResult | null {
  if (matches.length === 0) return null;

  const totals = matches.map((m) => m.scores.total);
  const avgTotal = average(totals);
  const wins = matches.filter((m) => m.won).length;
  const winRate = matches.length > 0 ? wins / matches.length : 0;

  const anchorSteps = stepsFromRankString(currentRank) ?? NEUTRAL_STEPS_FALLBACK;

  const adjustment =
    FIXED_BIAS_STEPS +
    winRateAdjustment(winRate, matches.length) +
    consistencyAdjustment(matches) +
    carryAdjustment(matches);
  const clampedAdjustment = Math.max(-MAX_ADJUSTMENT_STEPS, Math.min(MAX_ADJUSTMENT_STEPS, adjustment));

  const finalSteps = Math.round(anchorSteps + clampedAdjustment);

  return stepsToResult(finalSteps);
}

/**
 * Misma logica que computePerformanceRank, pero devolviendo cada numero
 * intermedio en vez de solo el resultado final -- para poder ver, jugador
 * por jugador, por que el motor dio el rango que dio y calibrar las
 * constantes de arriba (FIXED_BIAS_STEPS y los multiplicadores de
 * winRateAdjustment/consistencyAdjustment) con el Current Rank y
 * Performance Rank REALES de cada jugador delante en vez de a ciegas. No
 * se usa en el pipeline real de la app.
 */
export function computePerformanceRankDebug(
  matches: TitleEngineMatch[],
  currentRank: string | null = null
): PerformanceRankDebug | null {
  if (matches.length === 0) return null;

  const totals = matches.map((m) => m.scores.total);
  const avgTotal = average(totals);
  const wins = matches.filter((m) => m.won).length;
  const winRate = matches.length > 0 ? wins / matches.length : 0;

  const anchorSteps = stepsFromRankString(currentRank) ?? NEUTRAL_STEPS_FALLBACK;

  const wrAdj = winRateAdjustment(winRate, matches.length);
  const consAdj = consistencyAdjustment(matches);
  const carryAdj = carryAdjustment(matches);
  const rawAdjustment = FIXED_BIAS_STEPS + wrAdj + consAdj + carryAdj;
  const clampedAdjustment = Math.max(-MAX_ADJUSTMENT_STEPS, Math.min(MAX_ADJUSTMENT_STEPS, rawAdjustment));

  const finalSteps = Math.round(anchorSteps + clampedAdjustment);

  return {
    gamesPlayed: matches.length,
    avgTotal,
    winRate,
    wins,
    currentRank,
    anchorSteps,
    fixedBiasSteps: FIXED_BIAS_STEPS,
    winRateAdjustment: wrAdj,
    consistencyAdjustment: consAdj,
    carryAdjustment: carryAdj,
    rawAdjustment,
    clampedAdjustment,
    finalSteps,
    result: stepsToResult(finalSteps)
  };
}

export const PERFORMANCE_RANK_EXPLANATION = {
  title: "¿Cómo se calcula el Performance Rank?",
  summary:
    "Parte de tu Rango Actual (el oficial de Riot) y lo ajusta un poco segun winrate, consistencia y cuanto cargaste a tu equipo en tus ultimas partidas.",
  formula: "Rango Actual (ancla) - ajuste base + ajuste por winrate, consistencia y carry",
  points: [
    "Ancla: Tu Rango Actual es el punto de partida -- el Performance Rank nunca es una medida absoluta, siempre es relativo a tu propio rango.",
    "La mayoria de los jugadores queda en o levemente por debajo de su Rango Actual: no es matematicamente posible que la mayoria supere a la mediana de su propio elo.",
    "Winrate y consistencia: Ganar seguido y jugar parejo suman un poco; perder seguido o ser erratico resta un poco.",
    "Carry: Aportar mucho mas que tus companeros de equipo en partidas ganadas suma; aportar mucho menos en partidas perdidas resta."
  ]
};
