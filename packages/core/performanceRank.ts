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
 * REDISEÑO 2026-08-21 -- recalibracion con teamShare real + fit numerico.
 * Ver AGENT.md / conversacion con el usuario ese dia. LEER ESTO ANTES DE
 * TOCAR CUALQUIER CONSTANTE.
 * =============================================================================
 *
 * Historia: el rediseño anterior (2026-08-20 (2), ver git blame) uso
 * FIXED_BIAS_STEPS=-1.5 con carryAdjustment basado en dos thresholds fijos
 * (CARRY_THRESHOLD=0.26 / CARRIED_THRESHOLD=0.15) para distinguir "carry
 * claro" de "carga clara". Con los 9 fixtures reales YA con teamShare
 * calculado (refresh completo confirmado en Supabase, ver diagnostico de
 * distribucion agregado en scripts/test-rank-calibration.test.ts) se vio
 * que esos thresholds estaban mal calibrados: el teamShare real de un
 * jugador de LoL casi nunca sale de la banda [0.14, 0.27] -- los 6
 * sub-scores que lo componen ya vienen suavizados, y la varianza entre
 * los 5 jugadores de un equipo es mucho menor de lo que el diseño
 * original asumia. Resultado: 17-20 de cada 20 partidas caian en la zona
 * "ambigua" del modelo anterior, dejando carryAdjustment en 0.00 para la
 * mayoria de los jugadores pese a tener el dato completo.
 *
 * CAMBIO DE DISEÑO: carryAdjustment paso de "clasificar cada partida en
 * carry/carga/ambiguo con dos thresholds" a una señal continua: la
 * diferencia entre el teamShare promedio en victorias y el promedio en
 * derrotas (ver carryAdjustment mas abajo). Sigue capturando la misma
 * idea del usuario ("cuanto se gano/perdio gracias a el"), pero sin
 * descartar señal por caer cerca de 0.20.
 *
 * CALIBRACION: con los 9 fixtures (currentRank/Performance Rank real) se
 * corrio una busqueda en grilla (no a mano) sobre FIXED_BIAS_STEPS x
 * winRateAdjustment-multiplier x carryAdjustment-multiplier minimizando
 * el error absoluto medio en escalones. El optimo global fue bias=+0.5,
 * winrate x3.5, carry x20 (redondeado de +0.45/+3.5/+20.0), con 5/9
 * exactos y MAE=1.11 escalones -- una mejora real sobre el 1/9 anterior,
 * aunque lejos de perfecto: con solo 9 puntos y ruido de este tamaño, no
 * hay combinacion lineal de sesgo+winrate+carry que explique bien el caso
 * YourDaddyDrinks (67% winrate, la metrica que mas premia el modelo, pero
 * el Performance Rank real mas bajo que su Current Rank de los 9 casos --
 * ver su fila en el resumen de calibracion). Excluyendo ese outlier el
 * fit prefiere directamente NO restar nada por defecto (bias sube a
 * +0.8), lo que confirma que es un caso genuinamente anomalo para estas
 * variables, no un problema de calibracion del resto.
 *
 * IMPORTANTE: el signo de FIXED_BIAS_STEPS cambio de negativo a positivo
 * (+0.5, no -1.5). Esto contradice la intuicion original ("la mayoria no
 * puede estar por encima de la mediana de su propio lobby") pero es lo
 * que el fit numerico sobre datos reales pide -- el razonamiento teorico
 * del rediseño anterior no se sostuvo contra los 9 casos reales. Seguir
 * corriendo `bun run calibrate:rank` a medida que se agreguen mas
 * fixtures y re-ajustar si el bias no se siente calibrado con una muestra
 * mas grande.
 */

/**
 * Sesgo fijo, en escalones, sumado al Current Rank para llegar al
 * Performance Rank -- ver bloque de comentarios de arriba. Positivo:
 * contraintuitivo respecto al rediseño anterior, pero es lo que el fit
 * numerico sobre los 9 fixtures reales calibro.
 */
const FIXED_BIAS_STEPS = 0.5;

const MAX_ADJUSTMENT_STEPS = 4;

/**
 * Escalon absoluto (0 = Iron IV, ... ver RANK_TIERS) de un rango tipo
 * "Gold II". null si el string no matchea ningun tier conocido -- el
 * caller decide el fallback (normalmente NEUTRAL_STEPS_FALLBACK).
 *
 * Exportada para reusar la misma nocion de "fuerza de un rango" fuera de
 * este archivo -- ver ordenamiento por rango en RosterExplorer.tsx (antes
 * comparaba el tier solo, alfabeticamente, ignorando division y dando un
 * orden totalmente incorrecto: Bronze < Diamond < Emerald < Gold...
 * alfabetico, no por fuerza real).
 */
export function stepsFromRankString(rank: string | null | undefined): number | null {
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
 * fixtures, pero debil, no como para pesar fuerte). Multiplicador 3.5
 * calibrado por fit numerico (ver bloque de arriba) -- antes era 3, casi
 * igual, no cambia el comportamiento cualitativo. Maximo +-1.75 escalones
 * en los extremos (100%/0% con muestra suficiente).
 */
function winRateAdjustment(winRate: number, gamesPlayed: number): number {
  if (gamesPlayed < 4) return 0;
  const centered = winRate - 0.5; // -0.5..0.5
  return centered * 3.5; // Max +-1.75 escalones en casos 100% / 0%
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
 * REDISEÑO 2026-08-21: la version anterior clasificaba cada partida en
 * carry/carga/ambiguo con dos thresholds fijos (0.26/0.15). Con teamShare
 * real (ver bloque de comentarios grande al inicio del archivo) se vio que
 * el rango real de teamShare es mucho mas angosto de lo asumido (~0.14 a
 * ~0.27 en la practica, nunca cerca de los extremos teoricos 0/1) -- esos
 * thresholds dejaban 17-20 de cada 20 partidas en la zona ambigua, dando
 * carryAdjustment=0 para la mayoria de los jugadores pese a tener datos
 * completos.
 *
 * Ahora es una señal continua: diferencia entre el teamShare promedio en
 * partidas ganadas y el promedio en partidas perdidas. Positivo = aporto
 * mas cuando el equipo gano que cuando perdio (consistente con "carry
 * cuando importa"); negativo = lo opuesto. Sigue siendo direccional (la
 * misma idea del diseño anterior) pero sin descartar partidas por caer
 * cerca de 0.20 -- usa TODA la muestra en vez de solo los extremos.
 * Multiplicador x20 calibrado por fit numerico sobre los 9 fixtures (ver
 * bloque de comentarios grande al inicio) -- la correlacion real de esta
 * señal contra el ajuste necesario es debil (r~0.29 en el fit), asi que
 * sigue siendo un ajuste chico y acotado, no un factor dominante.
 */
function carryAdjustment(matches: TitleEngineMatch[]): number {
  const withTeamShare = matches.filter((m) => m.teamShare !== null);
  if (withTeamShare.length < 4) return 0;

  const wonShares = withTeamShare.filter((m) => m.won).map((m) => m.teamShare as number);
  const lostShares = withTeamShare.filter((m) => !m.won).map((m) => m.teamShare as number);
  if (wonShares.length === 0 || lostShares.length === 0) return 0;

  const avgWonShare = average(wonShares);
  const avgLostShare = average(lostShares);
  const diff = avgWonShare - avgLostShare; // tipicamente entre -0.05 y +0.05

  return Math.max(-1.5, Math.min(1.5, diff * 20));
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
  formula: "Rango Actual (ancla) + ajuste base + ajuste por winrate, consistencia y carry",
  points: [
    "Ancla: Tu Rango Actual es el punto de partida -- el Performance Rank nunca es una medida absoluta, siempre es relativo a tu propio rango.",
    "Winrate y consistencia: Ganar seguido y jugar parejo suman un poco; perder seguido o ser erratico resta un poco.",
    "Carry: Aportar mas en tus victorias que en tus derrotas (comparado con tu propio equipo) suma; lo opuesto resta."
  ]
};
