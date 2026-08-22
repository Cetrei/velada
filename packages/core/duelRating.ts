import type { MmradarPerformanceScores } from "./mmradarScraper";
import type { TitleEngineMatch } from "./titleEngine";
import { buildTitleEngineInput } from "./titleEngine";
import { skillRatingFromLolRank } from "./skillRating";
import { RANK_TIERS } from "./rankIcon";
import { stepsFromRankString } from "./performanceRank";

/**
 * =============================================================================
 * REDISEÑO 2026-08-21 -- ancla por rango + señales acotadas (mismo patron
 * que packages/core/performanceRank.ts). Ver AGENT.md / conversacion con
 * el usuario ese dia. LEER ESTO ANTES DE TOCAR CUALQUIER CONSTANTE.
 * =============================================================================
 *
 * Historia: el diseño anterior calculaba duelRating enteramente a partir
 * del score crudo de la partida (weightedCombatPower sobre combat/
 * teamfight/laning/etc, todo en la escala 0-2500 de mmradar) mas un bonus
 * por MVP rate/winrate/titulos, y pasaba ese numero por una curva
 * logistica con un midpoint FIJO (1750) para mapearlo a 0-100. Eso
 * significaba que el rating NUNCA usaba el Current Rank del jugador --
 * pese a que el contexto ya se lo pasaba (context.currentRank), solo se
 * lo reenviaba a buildTitleEngineInput para el titulo "underdog", nunca
 * entraba en la cuenta del rating en si.
 *
 * PROBLEMA: un combat/teamfight de, digamos, 1700 en Iron y el mismo 1700
 * en Diamond NO representan la misma habilidad mecanica real -- los
 * scores de mmradar ya vienen algo relativizados a la partida, pero un
 * jugador de Iron que saca 1700 esta dominando su propio bracket mucho
 * mas de lo que ese mismo numero implicaria en Diamond. Con un midpoint
 * fijo, dos jugadores con el mismo score crudo pero rangos muy distintos
 * salian con el mismo duelRating -- perdiendo toda la señal de "en que
 * nivel esta compitiendo esta persona", que es exactamente lo que
 * performanceRank.ts SI aprovecha usando currentRank como ancla.
 *
 * CAMBIO DE DISEÑO: mismo patron que computePerformanceRank -- el rango
 * actual (via stepsFromRankString, ya usado alli) se convierte en un
 * rating base 0-100 (posicion del jugador en la escala completa de rango),
 * y las señales de las partidas (combat power relativo, teamShare,
 * MVP rate, winrate) lo ajustan desde ahi en un rango acotado, nunca
 * reemplazandolo. Sin Current Rank disponible se cae al centro de la
 * escala (mismo criterio que NEUTRAL_STEPS_FALLBACK en performanceRank.ts).
 *
 * Que se reusa de la recalibracion de performanceRank:
 *  - teamShare como señal de dominancia individual: en performanceRank se
 *    uso para "carry" (diferencia won/lost). Para 1v1 la lectura es mas
 *    directa: un teamShare promedio alto (por encima del 0.2 parejo) es
 *    evidencia de que el jugador gana intercambios/pelea individualmente
 *    mejor que sus 4 companeros de equipo -- exactamente lo que "habilidad
 *    1v1" deberia capturar. Se sabe (ver performanceRank.ts) que el rango
 *    real de teamShare en la practica es angosto (~0.14 a ~0.27), asi que
 *    el multiplicador tiene que ser grande para que la señal no quede en
 *    ~0 (mismo problema que tenian los thresholds fijos viejos de carry).
 *  - Ajustes chicos y acotados (MAX_ADJUSTMENT_POINTS), nunca el factor
 *    dominante -- el ancla de rango sigue siendo lo que mas pesa, salvo
 *    cuando no hay currentRank.
 *  - Se elimina el bonus de titulos: los titulos (Duelist, Godlike,
 *    Hat-trick, etc) ya se derivan de combat/teamfight/mvpCount -- sumarlos
 *    de nuevo aca era contar la misma señal dos veces.
 *
 * PENDIENTE: a diferencia de performanceRank.ts, todavia no hay un
 * fixture set de duelRating "real" (un numero de referencia capturado a
 * mano por partida/torneo) contra el cual correr una calibracion
 * numerica -- scripts/test-rank-calibration.test.ts solo imprime
 * duelRating como dato informativo, no lo compara contra nada. Los
 * multiplicadores de abajo son un punto de partida razonado (mismo orden
 * de magnitud que los de performanceRank, escalados a la escala 0-100 en
 * vez de escalones de rango), no un fit numerico. Si en algun momento se
 * arma una lista de "quien le gano un 1v1 a quien" real, conviene agregar
 * un test de calibracion analogo a test-rank-calibration.test.ts para
 * ajustar estas constantes contra datos reales, igual que se hizo con
 * Performance Rank.
 */

const STAT_WEIGHTS: Record<keyof MmradarPerformanceScores, number> = {
  combat: 0.4,
  teamfight: 0.15,
  laning: 0.3,
  objectives: 0.05,
  farming: 0.05,
  vision: 0.02
};

/** Escala 0-2500 tipica de mmradar para los stats -- ver MMRADAR_SCORES_EXPLAINED en content.ts. */
const NEUTRAL_COMBAT_POWER = 1200;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function weightedCombatPower(scores: MmradarPerformanceScores): number {
  return (Object.keys(STAT_WEIGHTS) as (keyof MmradarPerformanceScores)[]).reduce(
    (sum, key) => sum + scores[key] * STAT_WEIGHTS[key],
    0
  );
}

/** Rating base 0-100 segun el rango actual -- posicion en la escala completa de RANK_TIERS. */
const RATING_SCALE_STEPS = RANK_TIERS.length * 4 - 1;

/**
 * Rating 0-100 si no hay ninguna partida ni rango: centro de la escala,
 * mismo criterio que NEUTRAL_STEPS_FALLBACK en performanceRank.ts -- ni
 * castiga ni favorece a un jugador del que no se sabe nada todavia.
 */
const NEUTRAL_RATING_FALLBACK = 50;

/**
 * Cuanto pesa el rango actual como ancla del rating, en puntos maximos
 * sobre 100 -- el 100% de la escala completa (0 = Iron IV, 100 = Challenger).
 */
function anchorRatingFromRank(currentRank: string | null): number {
  const steps = stepsFromRankString(currentRank);
  if (steps === null) return NEUTRAL_RATING_FALLBACK;
  return clamp((steps / RATING_SCALE_STEPS) * 100, 1, 99);
}

const MAX_ADJUSTMENT_POINTS = 20;

/**
 * Cuanto desvia el combat power ponderado (relativo a un baseline neutral,
 * NO absoluto) el rating respecto al ancla de rango. Positivo = pelea/
 * carrilea/teamfightea por encima de lo esperable para su propio bracket;
 * negativo = por debajo. Acotado -- ver MAX_ADJUSTMENT_POINTS.
 */
function combatPowerAdjustment(scores: MmradarPerformanceScores): number {
  const power = weightedCombatPower(scores);
  const centered = (power - NEUTRAL_COMBAT_POWER) / NEUTRAL_COMBAT_POWER; // tipicamente -0.3..0.6
  return clamp(centered * 25, -18, 18);
}

/**
 * Dominancia individual dentro del propio equipo (ver teamShare en
 * TitleEngineMatch / el comentario grande de carryAdjustment en
 * performanceRank.ts sobre por que el rango real es angosto ~0.14-0.27).
 * A diferencia de carryAdjustment (que compara won vs lost), para 1v1 se
 * usa directamente el promedio general: un jugador que aporta mas que sus
 * 4 companeros de forma consistente (gane o pierda esa partida puntual)
 * esta ganando mas intercambios individuales, que es la señal que importa
 * para habilidad 1v1.
 */
function teamShareAdjustment(matches: TitleEngineMatch[]): number {
  const shares = matches.map((m) => m.teamShare).filter((s): s is number => s !== null);
  if (shares.length < 3) return 0;

  const avgShare = average(shares);
  const centered = avgShare - 0.2; // 0.2 = aporte parejo entre 5, tipicamente -0.06..0.07 en la practica
  return clamp(centered * 130, -12, 12);
}

/** MVP rate (wasTopScoreInMatch): salir con el score total mas alto de las 10 seguido. Acotado. */
function mvpRateAdjustment(matches: TitleEngineMatch[]): number {
  if (matches.length === 0) return 0;
  const mvpCount = matches.filter((m) => m.wasTopScoreInMatch).length;
  const mvpRate = mvpCount / matches.length;
  return clamp(mvpRate * 14, 0, 14);
}

/** Winrate: señal debil de habilidad individual (depende mucho del equipo) -- acotado chico. */
function winRateAdjustment(matches: TitleEngineMatch[]): number {
  if (matches.length < 4) return 0;
  const wins = matches.filter((m) => m.won).length;
  const winRate = wins / matches.length;
  const centered = winRate - 0.5;
  return clamp(centered * 10, -5, 5);
}

export interface DuelRatingResult {
  /** 0-100, pensado para mostrarse como "puntaje de poder" de un duelo directo. */
  rating: number;
  /**
   * 0-1, que tan confiable es el numero segun cuantas partidas hay detras
   * (pocas partidas = numero mas volatil/menos representativo). Se
   * cachea junto al rating para que el componente de UI pueda mostrar un
   * aviso tipo "basado en pocas partidas" sin tener que re-derivar esto.
   */
  confidence: number;
  gamesConsidered: number;
}

/**
 * Desglose completo del calculo, pensado para diagnostico/calibracion --
 * mismo espiritu que PerformanceRankDebug en performanceRank.ts. Nunca se
 * usa en el pipeline real de la app.
 */
export interface DuelRatingDebug {
  gamesPlayed: number;
  currentRank: string | null;
  anchorRating: number;
  combatPowerAdjustment: number;
  teamShareAdjustment: number;
  mvpRateAdjustment: number;
  winRateAdjustment: number;
  rawAdjustment: number;
  clampedAdjustment: number;
  finalRating: number;
}

const MIN_GAMES_FOR_FULL_CONFIDENCE = 12;

export function computeDuelRatingFromMatches(
  matches: TitleEngineMatch[],
  context: { performanceRank: string | null; currentRank: string | null }
): DuelRatingResult | null {
  if (matches.length === 0) return null;

  const input = buildTitleEngineInput(matches, context);

  const anchorRating = anchorRatingFromRank(context.currentRank);
  const adjustment =
    combatPowerAdjustment(input.averages) +
    teamShareAdjustment(matches) +
    mvpRateAdjustment(matches) +
    winRateAdjustment(matches);
  const clampedAdjustment = clamp(adjustment, -MAX_ADJUSTMENT_POINTS, MAX_ADJUSTMENT_POINTS);

  const rating = Math.round(clamp(anchorRating + clampedAdjustment, 1, 99));
  const confidence = clamp(matches.length / MIN_GAMES_FOR_FULL_CONFIDENCE, 0.25, 1);

  return { rating, confidence, gamesConsidered: matches.length };
}

/**
 * Misma logica que computeDuelRatingFromMatches, pero devolviendo cada
 * numero intermedio -- para diagnostico/calibracion futura (ver el
 * comentario grande de arriba sobre la falta de un fixture set real
 * todavia). No se usa en el pipeline real de la app.
 */
export function computeDuelRatingDebug(
  matches: TitleEngineMatch[],
  context: { performanceRank: string | null; currentRank: string | null }
): DuelRatingDebug | null {
  if (matches.length === 0) return null;

  const input = buildTitleEngineInput(matches, context);

  const anchorRating = anchorRatingFromRank(context.currentRank);
  const combatAdj = combatPowerAdjustment(input.averages);
  const teamShareAdj = teamShareAdjustment(matches);
  const mvpAdj = mvpRateAdjustment(matches);
  const wrAdj = winRateAdjustment(matches);
  const rawAdjustment = combatAdj + teamShareAdj + mvpAdj + wrAdj;
  const clampedAdjustment = clamp(rawAdjustment, -MAX_ADJUSTMENT_POINTS, MAX_ADJUSTMENT_POINTS);
  const finalRating = Math.round(clamp(anchorRating + clampedAdjustment, 1, 99));

  return {
    gamesPlayed: matches.length,
    currentRank: context.currentRank,
    anchorRating,
    combatPowerAdjustment: combatAdj,
    teamShareAdjustment: teamShareAdj,
    mvpRateAdjustment: mvpAdj,
    winRateAdjustment: wrAdj,
    rawAdjustment,
    clampedAdjustment,
    finalRating
  };
}

export function computeDuelRatingFromLolRank(lolRank: string | null | undefined): DuelRatingResult | null {
  const tierScore = skillRatingFromLolRank(lolRank); // 0-100 aprox, ver skillRating.ts
  if (tierScore === 0) return null;
  return { rating: Math.round(clamp(tierScore, 1, 99)), confidence: 0.3, gamesConsidered: 0 };
}

export interface DuelInput {
  duelRating?: number | null;
  lolRank?: string | null;
}

function ratingOrFallback(input: DuelInput): number {
  if (typeof input.duelRating === "number") return input.duelRating;
  const fallback = computeDuelRatingFromLolRank(input.lolRank);
  return fallback?.rating ?? 50;
}

export interface DuelProbabilityResult {
  /** Probabilidad (0-100, redondeada) de que gane el jugador A. */
  playerAWinPct: number;
  playerBWinPct: number;
}

export function computeDuelWinProbability(playerA: DuelInput, playerB: DuelInput): DuelProbabilityResult {
  const ratingA = ratingOrFallback(playerA);
  const ratingB = ratingOrFallback(playerB);

  const diff = ratingA - ratingB;
  const probA = 1 / (1 + Math.exp(-diff / 12));

  const playerAWinPct = Math.round(clamp(probA * 100, 2, 98));
  return { playerAWinPct, playerBWinPct: 100 - playerAWinPct };
}

/**
 * Comparacion de Performance Rank entre dos peleadores, pensada para la
 * pagina de detalle de un combate 1v1 (pedido del usuario 2026-08-21:
 * "una comparacion de sus performances y sus duel rank... proporcional a
 * la diferencia de nivel"). A diferencia de computeDuelWinProbability
 * (que compara el numero 0-100 de duelRating), esto compara el
 * PERFORMANCE RANK (ej. "Platinum II" vs "Gold IV") -- la otra metrica
 * que ya existe en el perfil de cada peleador y que la ficha individual
 * ya muestra por separado, nunca comparada contra un rival.
 *
 * Reusa stepsFromRankString (misma escala de 0 a RANK_TIERS.length*4-1
 * que ya usa duelRating.ts para su propio ancla) y la misma curva
 * logistica que computeDuelWinProbability, para que "probabilidad
 * proporcional a la diferencia de nivel" tenga el mismo significado en
 * los dos factores que se muestran lado a lado. Si algun peleador no
 * tiene performanceRank todavia (sin partidas de mmradar cargadas), cae
 * al lolRank (rango oficial) como aproximacion -- mismo fallback que
 * ratingOrFallback usa para duelRating.
 */
export interface PerformanceComparisonInput {
  performanceRank?: string | null;
  lolRank?: string | null;
}

export interface PerformanceComparisonResult {
  playerAWinPct: number;
  playerBWinPct: number;
  /** Steps 0-100 normalizados de cada jugador, para dibujar la barra de nivel si hace falta. */
  playerARating: number;
  playerBRating: number;
}

function performanceRatingOrFallback(input: PerformanceComparisonInput): number {
  const steps = stepsFromRankString(input.performanceRank ?? input.lolRank ?? null);
  if (steps === null) return NEUTRAL_RATING_FALLBACK;
  return clamp((steps / RATING_SCALE_STEPS) * 100, 1, 99);
}

export function computePerformanceComparison(
  playerA: PerformanceComparisonInput,
  playerB: PerformanceComparisonInput
): PerformanceComparisonResult {
  const ratingA = performanceRatingOrFallback(playerA);
  const ratingB = performanceRatingOrFallback(playerB);

  const diff = ratingA - ratingB;
  const probA = 1 / (1 + Math.exp(-diff / 12));

  const playerAWinPct = Math.round(clamp(probA * 100, 2, 98));
  return { playerAWinPct, playerBWinPct: 100 - playerAWinPct, playerARating: Math.round(ratingA), playerBRating: Math.round(ratingB) };
}

/**
 * Combina Performance Rank y Habilidad 1v1 (duelRating) en una sola
 * probabilidad "quien es mas probable a ganar", pedido explicito del
 * usuario 2026-08-21 para la pagina de detalle de un combate 1v1:
 * "con esos dos que esteticamente se muestre quien es el mas probable a
 * ganar bajo esos dos factores (proporcional a la diferencia de nivel)".
 * Promedia linealmente el rating 0-100 de cada factor (mismo peso para
 * ambos -- no hay evidencia todavia de que uno prediga mejor que el otro,
 * ver el PENDIENTE de mas arriba sobre la falta de un fixture set real de
 * duelRating) y aplica la misma curva logistica que los otros dos
 * comparadores, para que la proporcionalidad a la diferencia de nivel sea
 * consistente en los tres.
 */
export interface OverallComparisonInput {
  duelRating?: number | null;
  performanceRank?: string | null;
  lolRank?: string | null;
}

export interface OverallComparisonResult {
  playerAWinPct: number;
  playerBWinPct: number;
  performance: PerformanceComparisonResult;
  duel: DuelProbabilityResult;
}

export function computeOverallWinComparison(
  playerA: OverallComparisonInput,
  playerB: OverallComparisonInput
): OverallComparisonResult {
  const performance = computePerformanceComparison(playerA, playerB);
  const duel = computeDuelWinProbability(playerA, playerB);

  const ratingA = (performanceRatingOrFallback(playerA) + ratingOrFallback(playerA)) / 2;
  const ratingB = (performanceRatingOrFallback(playerB) + ratingOrFallback(playerB)) / 2;

  const diff = ratingA - ratingB;
  const probA = 1 / (1 + Math.exp(-diff / 12));

  const playerAWinPct = Math.round(clamp(probA * 100, 2, 98));
  return { playerAWinPct, playerBWinPct: 100 - playerAWinPct, performance, duel };
}

/**
 * Promedio de duelRating y de Performance Rank (en steps normalizados
 * 0-100, misma escala que el resto de este archivo) de un equipo completo
 * -- pedido del usuario 2026-08-21 para el desglose de equipo en
 * /combates/equipo/[id]: "En el equipo puedes poner el promedio de
 * performance y duel rank". Ignora participantes sin ningun dato (ni
 * duelRating/performanceRank ni lolRank) en vez de contarlos como 50
 * neutral, para que un equipo con datos reales no se diluya hacia el
 * centro por companeros sin ficha de mmradar todavia.
 */
export interface TeamAverageInput {
  duelRating?: number | null;
  performanceRank?: string | null;
  lolRank?: string | null;
}

export interface TeamAverageResult {
  /** null si ningun miembro del equipo tiene dato suficiente para calcularlo. */
  avgDuelRating: number | null;
  avgPerformanceRating: number | null;
  membersConsidered: number;
}

export function computeTeamAverages(members: TeamAverageInput[]): TeamAverageResult {
  const duelValues = members
    .filter((m) => typeof m.duelRating === "number" || Boolean(m.lolRank))
    .map((m) => ratingOrFallback(m));
  const perfValues = members
    .filter((m) => Boolean(m.performanceRank) || Boolean(m.lolRank))
    .map((m) => performanceRatingOrFallback(m));

  return {
    avgDuelRating: duelValues.length > 0 ? Math.round(average(duelValues)) : null,
    avgPerformanceRating: perfValues.length > 0 ? Math.round(average(perfValues)) : null,
    membersConsidered: members.length
  };
}

export const DUEL_RATING_EXPLANATION = {
  title: "¿Cómo se calcula la Habilidad 1v1?",
  summary:
    "Es un puntaje de 0 a 100 que parte de tu Rango Actual y lo ajusta segun que tan dominante peleas dentro de tu propio equipo en tus partidas recientes.",
  formula: "Rango Actual (ancla) + ajuste por Combat/Teamfight/Laning relativos a tu bracket + cuanto superas a tus companeros + MVPs + winrate",
  points: [
    "Ancla: tu Rango Actual es el punto de partida -- pelear bien en Iron y pelear bien en Diamond no es la misma habilidad mecanica absoluta, asi que el numero siempre es relativo a tu propio nivel.",
    "Combat, Teamfight y Laning (lo que mas pesa) comparados contra un promedio esperable suman o restan segun estes por encima o por debajo de lo tipico.",
    "Cuanto aportas dentro de TU equipo de 5 (mas que tus companeros = mas protagonismo en los intercambios) suma puntos.",
    "Salir MVP seguido (el mejor puntaje de la partida) y tener buen winrate suman un poco mas, pero son la señal mas debil de las cuatro.",
    "Con pocas partidas jugadas el número es menos confiable todavía -- se muestra un aviso cuando eso pasa."
  ],
  probabilityFormula:
    "La probabilidad de ganar un 1v1 sale de comparar los dos puntajes: cuanto más grande la diferencia, más lejos del 50/50 -- pero nunca 100% seguro para nadie."
};
