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
 * REDISEÑO 2026-08-21 (4) -- fit numerico completo sobre los 9 fixtures con
 * los 4 ajustes ya integrados (winrate, consistencia, carry, perfil de
 * stats). Ver AGENT.md / conversacion con el usuario ese dia. LEER ESTO
 * ANTES DE TOCAR CUALQUIER CONSTANTE.
 * =============================================================================
 *
 * Historia: la sesion anterior (2026-08-21 (3)) integro statProfileAdjustment
 * al calculo (estaba escrita pero nunca sumada) sin recalibrar el resto de
 * los multiplicadores contra los 9 fixtures reales -- goldeando a mano solo
 * el caso Nashi/YourDaddyDrinks. Resultado real medido con
 * `bun run calibrate:rank`: el ratio de aciertos BAJO de 6/9 a 4/9 --
 * statProfileAdjustment arreglaba a YourDaddyDrinks parcialmente pero
 * rompia a CiaN L9#Mango y sovieticboy dou#lan, que antes acertaban. La
 * leccion: agregar una señal nueva sin volver a correr el fit completo
 * sobre TODOS los fixtures (no solo los 2 que motivaron la señal) puede
 * empeorar el resultado neto, aunque la señal en si sea razonable.
 *
 * FIX REAL: se reconstruyeron los 4 valores crudos (pre-multiplicador) de
 * cada ajuste para los 9 jugadores a partir del log real de
 * `bun run calibrate:rank` (winRate centrado, coeficiente de variacion,
 * diff de teamShare won/lost, mechanicalShare centrado) y se corrio una
 * busqueda en grilla exhaustiva (no a mano) sobre
 * FIXED_BIAS_STEPS x winRateAdjustment-mult x consistencyAdjustment-mult x
 * carryAdjustment-mult x statProfileAdjustment-mult, minimizando primero
 * la cantidad de aciertos exactos y despues el error absoluto medio.
 *
 * RESULTADO: bias=-1.5, winrate x2.5, consistencia x22, carry x32, perfil
 * de stats x36 -- 8/9 exactos, MAE=0.11 escalones. Confirmado por busqueda
 * exhaustiva que NO existe ninguna combinacion lineal de estas 5 constantes
 * que acierte los 9: L9 LegenPaPaNoel#TVIS (15% winrate, 3W/17L, el peor
 * winrate de los 9) necesita subir apenas +1 escalon sobre su Current Rank
 * en vez de bajar, algo que ninguna combinacion de señales actuales explica
 * sin romper a otro jugador -- se acepta como el unico desvio conocido en
 * vez de seguir ajustando a ciegas. Si se agrega una señal nueva en el
 * futuro (ver PENDIENTE en el comentario de statProfileAdjustment sobre
 * rol jugado), hay que volver a correr esta misma busqueda en grilla sobre
 * los 9 (o mas) fixtures completos ANTES de dar la señal por calibrada --
 * no alcanza con verificar a mano 1-2 casos puntuales, como paso en la
 * sesion (3).
 *
 * Metodologia reusable (ver /tmp en la sesion original, no versionado):
 * reconstruir crudo = valor_mostrado_en_log / multiplicador_actual para
 * cada ajuste de cada jugador, despues iterar sobre rangos de cada
 * multiplicador evaluando `round(anchorSteps + clamp(bias + sum(crudo_i *
 * mult_i), -4, 4))` contra el escalon esperado real.
 */

/**
 * Sesgo fijo, en escalones, sumado al Current Rank para llegar al
 * Performance Rank -- ver bloque de comentarios de arriba. Calibrado por
 * busqueda en grilla sobre los 9 fixtures reales (2026-08-21 (4)).
 */
const FIXED_BIAS_STEPS = -1.5;

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
 * escalones -- ajuste chico y acotado, nunca el factor dominante. Multiplicador
 * 2.5 calibrado por busqueda en grilla sobre los 9 fixtures reales
 * (2026-08-21 (4), ver bloque de comentarios de arriba). Maximo +-1.25
 * escalones en los extremos (100%/0% con muestra suficiente).
 */
function winRateAdjustment(winRate: number, gamesPlayed: number): number {
  if (gamesPlayed < 4) return 0;
  const centered = winRate - 0.5; // -0.5..0.5
  return centered * 2.5; // Max +-1.25 escalones en casos 100% / 0%
}

/**
 * Cuanto desvia la consistencia (que tan parejo jugo entre partidas) el
 * Performance Rank respecto al sesgo fijo, en escalones -- mismo criterio
 * acotado que winRateAdjustment. Multiplicador 22 calibrado por busqueda
 * en grilla sobre los 9 fixtures reales (2026-08-21 (4)). Jugar mas parejo
 * que el coeficiente de variacion "neutral" (0.2) suma hasta +1.5
 * escalones; jugar muy erratico resta hasta -1.5.
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
  return Math.max(-1.5, Math.min(1.5, centered * 22));
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

  return Math.max(-1.5, Math.min(1.5, diff * 32));
}

/**
 * REDISEÑO 2026-08-21 (2) -- señal de COMPOSICION de stats, agregada tras
 * comparar a mano dos jugadores de rango casi identico (Platinum
 * III/IV) con Performance Rank real muy distinto (Nashi -> Platinum II,
 * bien calibrado; YourDaddyDrinks -> Gold I, el peor desvio de los 9
 * fixtures). Ver AGENT.md para el detalle de la comparacion.
 *
 * EL PROBLEMA QUE ESTO RESUELVE: avgTotal (via consistencyAdjustment) y
 * carryAdjustment (via teamShare) miran cuÁNTO aporta el jugador, nunca
 * en QUE aporta. Dos jugadores pueden tener el mismo total y el mismo
 * teamShare con composiciones de stats opuestas -- uno "mecanico" (gana
 * peleas: combat/teamfight/laning altos) y otro "macro" (mueve mapa:
 * objectives/vision altos, pero combat/teamfight/laning mediocres para
 * su propio rango). Comparando los perfiles reales (promedios de sus
 * ultimas partidas):
 *   Nashi (Plat III, esperado Plat II):        combat 1926, teamfight
 *     1973, laning 1750 -- objectives 1306 (su stat mas bajo).
 *     mechanicalShare = (1926+1973+1750) / total ≈ 0.54
 *   YourDaddyDrinks (Plat IV, esperado Gold I): combat 1511, teamfight
 *     1543, laning 1610 -- objectives 1957, vision 1971 (sus dos stats
 *     mas altos, muy por encima del resto).
 *     mechanicalShare = (1511+1543+1610) / total ≈ 0.46
 * Ningun ajuste existente capturaba esto: YourDaddyDrinks tenia buen
 * winrate (67%) y buen avgTotal, asi que el modelo lo empujaba PARA
 * ARRIBA (rango real mas bajo que Current Rank) cuando el patron de sus
 * stats es justamente el de alguien mecanicamente mas debil que su
 * bracket -- gana partidas por objetivos/vision, no por pelear.
 *
 * DISEÑO: fraccion del total que representa el bloque "mecanico" (combat
 * + teamfight + laning, las 3 stats que mas pesan en duelRating.ts --
 * mismo criterio de que stats reflejan habilidad de pelea/1v1 que ya se
 * uso alli) contra el bloque "macro" (objectives + farming + vision).
 * 0.5 = mitad y mitad, neutral. Por encima = perfil mecanico (empuja el
 * Performance Rank hacia arriba); por debajo = perfil macro (empuja
 * hacia abajo).
 *
 * Deliberadamente separado de carryAdjustment: ese mira teamShare
 * (cuÁNTO aporta comparado a sus companeros, gane o pierda), este mira
 * la composicion INTERNA del propio jugador (en QUE aporta) -- son
 * señales ortogonales, un jugador puede tener alto teamShare con
 * cualquiera de los dos perfiles.
 *
 * CALIBRACION: al igual que paso con teamShare/carryAdjustment (ver
 * bloque de comentarios grande al inicio del archivo), mechanicalShare en
 * la practica vive en una banda angosta -- los dos casos de referencia de
 * arriba difieren solo ~0.08 (0.54 vs 0.46) pese a tener Performance Rank
 * real a 3 escalones de distancia relativa a su rango. Multiplicador x18
 * (no un fit numerico todavia, no hay fixture set suficiente para eso --
 * ver PENDIENTE mas abajo) elegido para que una diferencia de ese orden
 * (~0.08) ya mueva el ajuste una cantidad notoria (~0.7-0.75 escalones)
 * sin que sea automaticamente el maximo.
 *
 * VERIFICADO A MANO (2026-08-21 (3)): con x18, YourDaddyDrinks pasa de
 * Platinum II a Platinum III (18 -> 17 escalones) -- se acerca al Gold I
 * esperado (15) pero no llega, y NINGUN multiplicador mayor cierra esa
 * brecha sin romper a Nashi (que ya estaba bien calibrado en Platinum
 * II): mechanicalShare esta capada en +-1.5 escalones (igual que
 * carryAdjustment), y ese tope se alcanza con x~28 para YourDaddyDrinks
 * (0.46 de share) sin mover mas su resultado -- a partir de ahi, subir el
 * multiplicador solo sigue empujando a Nashi (0.54 de share, mas cerca de
 * 0.5) hasta romperlo. Es la misma limitacion que ya documentaba el
 * bloque de comentarios grande al inicio del archivo sobre YourDaddyDrinks
 * como outlier: la composicion de stats es señal real y suma en la
 * direccion correcta, pero no alcanza sola para explicar un desvio de 3
 * escalones -- hace falta una variable mas (candidato: rol jugado, que
 * este proyecto no trackea) o aceptar que ese caso puntual no calibra
 * perfecto con las variables disponibles. Correr `bun run calibrate:rank`
 * para confirmar el resultado real (con los 9 fixtures completos, no solo
 * estos dos) y re-ajustar si hace falta una vez que haya mas casos para
 * comparar.
 */
function statProfileAdjustment(matches: TitleEngineMatch[]): number {
  if (matches.length < 4) return 0;

  const avgCombat = average(matches.map((m) => m.scores.combat));
  const avgTeamfight = average(matches.map((m) => m.scores.teamfight));
  const avgLaning = average(matches.map((m) => m.scores.laning));
  const avgObjectives = average(matches.map((m) => m.scores.objectives));
  const avgFarming = average(matches.map((m) => m.scores.farming));
  const avgVision = average(matches.map((m) => m.scores.vision));

  const mechanicalTotal = avgCombat + avgTeamfight + avgLaning;
  const macroTotal = avgObjectives + avgFarming + avgVision;
  const grandTotal = mechanicalTotal + macroTotal;
  if (grandTotal <= 0) return 0;

  const mechanicalShare = mechanicalTotal / grandTotal; // tipicamente 0.42-0.58
  const centered = mechanicalShare - 0.5;
  return Math.max(-1.5, Math.min(1.5, centered * 36));
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
  statProfileAdjustment: number;
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
    carryAdjustment(matches) +
    statProfileAdjustment(matches);
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
  const statProfileAdj = statProfileAdjustment(matches);
  const rawAdjustment = FIXED_BIAS_STEPS + wrAdj + consAdj + carryAdj + statProfileAdj;
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
    statProfileAdjustment: statProfileAdj,
    rawAdjustment,
    clampedAdjustment,
    finalSteps,
    result: stepsToResult(finalSteps)
  };
}

export const PERFORMANCE_RANK_EXPLANATION = {
  title: "¿Cómo se calcula el Performance Rank?",
  summary:
    "Parte de tu Rango Actual (el oficial de Riot) y lo ajusta un poco segun winrate, consistencia, cuanto cargaste a tu equipo y en que tipo de stats destacas en tus ultimas partidas.",
  formula:
    "Rango Actual (ancla) + ajuste base + ajuste por winrate, consistencia, carry y perfil de stats",
  points: [
    "Ancla: Tu Rango Actual es el punto de partida -- el Performance Rank nunca es una medida absoluta, siempre es relativo a tu propio rango.",
    "Winrate y consistencia: Ganar seguido y jugar parejo suman un poco; perder seguido o ser erratico resta un poco.",
    "Carry: Aportar mas en tus victorias que en tus derrotas (comparado con tu propio equipo) suma; lo opuesto resta.",
    "Perfil de stats: Destacar en Combat/Teamfight/Laning (pelea) por encima de Objectives/Farming/Vision (macro) suma un poco; lo opuesto resta -- dos jugadores con el mismo puntaje total pueden tener perfiles muy distintos."
  ]
};
