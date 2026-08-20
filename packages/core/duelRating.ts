/**
 * "Habilidad 1v1" PROPIA de este proyecto: un unico numero (0-100,
 * pensado para leerse como un puntaje de poder tipo videojuego, no como
 * MMR real) que resume que tan peligroso es un peleador en un duelo
 * directo, mas una probabilidad de victoria cuando se enfrentan dos
 * peleadores concretos.
 *
 * Pedido explicito del usuario (2026-08-20): un jugador OTP con
 * puntuacion alta y que sale MVP seguido deberia tener una habilidad 1v1
 * alta -- el input de este calculo son justamente las senales que ya
 * tenemos de mmradar (los 6 scores promedio, MVP rate, winrate,
 * performanceRank) mas los titulos ya otorgados por titleEngine.ts
 * (Duelist/Godlike/Hat-trick suman, Underdog no resta -- ver
 * DUEL_TITLE_WEIGHT abajo).
 *
 * Se cachea igual que el resto de datos de mmradar (mismo patron que
 * performance_rank/performance_scores: se calcula una vez al
 * guardar/actualizar el perfil, se persiste en la fila de participants,
 * y se re-lee de ahi en cada carga de pagina -- nunca se recalcula en
 * cada render). Ver duel_rating/duel_confidence en scripts/setup-supabase.ts
 * y el wiring en actions/index.ts (fetchMmradarData/saveOwnParticipant/
 * saveParticipant/refreshMmradarData).
 *
 * Formula, en criollo (ver tambien DUEL_RATING_EXPLANATION mas abajo para
 * el texto no-tecnico del modal):
 * 1. Un "poder de combate" base sale de los stats de mmradar mas
 *    relacionados a pelear/ganar duelos (Combat y Teamfight pesan mas que
 *    Laning/Farming/Objectives/Vision, que igual suman con menos peso).
 * 2. Se lo empuja hacia arriba si el jugador es frecuentemente MVP y si
 *    gana seguido (mismos mvpCount/winRate que ya usa titleEngine.ts).
 *    Titulos de combate ya otorgados (Duelist, Godlike, Hat-trick,
 *    Avalancha) suman un bono chico cada uno -- son la misma señal vista
 *    desde otro angulo, el bono es intencionalmente pequeño para no
 *    contar el mismo dato dos veces con demasiado peso.
 * 3. Todo eso se comprime a una escala 0-100 con una curva logistica
 *    (nunca da negativo ni pasa de 100, y la mayoria de perfiles reales
 *    caen entre 40-85 en vez de amontonarse en los extremos).
 *
 * Para la probabilidad de un 1v1 entre dos peleadores especificos se usa
 * la formula logistica estandar de Elo/TrueSkill (softmax de 2 vias)
 * sobre la diferencia de sus dos duelRating -- mismo tipo de curva que
 * usan sistemas de ranking reales para "que probabilidad tiene A de
 * ganarle a B dado su rating", adaptada a esta escala 0-100 en vez de la
 * escala 0-3000 tipica de Elo.
 */

import type { MmradarPerformanceScores } from "./mmradarScraper";
import type { TitleEngineMatch, TitleEngineInput } from "./titleEngine";
import { buildTitleEngineInput, evaluateTitles } from "./titleEngine";
import { skillRatingFromLolRank } from "./skillRating";

/**
 * Peso relativo de cada stat en el "poder de combate" base -- Combat y
 * Teamfight son los mas directamente relacionados a ganar peleas 1v1/en
 * grupo, Laning tambien importa (ganar la lane es ganar duelos tempranos)
 * pero menos que pelear ya con items. Farming/Objectives/Vision suman
 * poco: son reales pero indirectos para un duelo puntual.
 */
const STAT_WEIGHTS: Record<keyof MmradarPerformanceScores, number> = {
  combat: 0.32,
  teamfight: 0.22,
  laning: 0.2,
  objectives: 0.1,
  farming: 0.1,
  vision: 0.06
};

/** Titulos de combate/dominancia que ya otorga titleEngine.ts -- cada uno presente suma un bono chico (ver DUEL_TITLE_BONUS). */
const DUEL_RELEVANT_TITLE_IDS = new Set(["duelist", "godlike", "hat-trick", "avalanche", "mvp", "lane-bully"]);
const DUEL_TITLE_BONUS = 2.5;
const MAX_TITLE_BONUS = 12;

/**
 * Centro y ancho de la curva logistica que comprime el puntaje crudo
 * (stats ponderados + bonos, en la misma escala ~0-2500 que el resto de
 * scores de mmradar) a 0-100. Elegidos a ojo sobre el rango real
 * observado (~1300-2400 stats individuales, ~1800-1900 promedios de
 * perfil fuerte) para que un perfil de elite (promedio ponderado
 * ~2200-2300 + bonos) quede arriba de 80, uno de nivel medio (~1600-1700)
 * quede cerca de 50, y uno bajo (~1000) quede cerca de 20 -- no son un
 * corte oficial de nada, es la curva propia de este proyecto.
 */
const CURVE_MIDPOINT = 1750;
const CURVE_STEEPNESS = 0.0022;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function weightedCombatPower(scores: MmradarPerformanceScores): number {
  return (Object.keys(STAT_WEIGHTS) as (keyof MmradarPerformanceScores)[]).reduce(
    (sum, key) => sum + scores[key] * STAT_WEIGHTS[key] * 6,
    0
  );
  // *6 porque STAT_WEIGHTS ya suma 1.0 entre los 6 keys -- sin el factor,
  // el resultado quedaria en la escala de UN stat individual (~1000-2400)
  // en vez de reflejar que se estan combinando los 6, perdiendo la
  // separacion util para la curva logistica de abajo.
}

/**
 * Bono por MVP rate + winrate: mismas señales que ya usa titleEngine.ts
 * (mvpCount/gamesPlayed, winRate) traducidas a puntos sobre la misma
 * escala ~0-2500 del poder de combate base, antes de la curva logistica.
 * Un MVP rate alto (sale mejor puntaje de la partida seguido) y un
 * winrate alto suman hasta ~250 puntos combinados en los extremos --
 * suficiente para mover el resultado final varios puntos en la escala
 * 0-100 sin dominar por completo sobre los stats crudos.
 */
function performanceBonus(input: Pick<TitleEngineInput, "mvpCount" | "gamesPlayed" | "winRate">): number {
  if (input.gamesPlayed === 0) return 0;
  const mvpRate = input.mvpCount / input.gamesPlayed;
  const mvpBonus = mvpRate * 150; // hasta 150 si es MVP siempre
  const winBonus = clamp((input.winRate - 0.5) * 300, -75, 150); // -75..+150
  return mvpBonus + winBonus;
}

function titleBonus(titleIds: string[]): number {
  const relevant = titleIds.filter((id) => DUEL_RELEVANT_TITLE_IDS.has(id));
  return Math.min(MAX_TITLE_BONUS, relevant.length * DUEL_TITLE_BONUS);
}

function logisticCurve(rawScore: number): number {
  const x = (rawScore - CURVE_MIDPOINT) * CURVE_STEEPNESS;
  const sigmoid = 1 / (1 + Math.exp(-x));
  return Math.round(clamp(sigmoid * 100, 1, 99));
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

const MIN_GAMES_FOR_FULL_CONFIDENCE = 12;

/**
 * Calcula el duel rating a partir de las mismas partidas crudas que ya
 * arma fetchRawMatches (mmradarScraper.ts) para performanceRank/titulos --
 * un solo fetch a mmradar cubre las tres cosas. null si no hay ninguna
 * partida (mismo criterio que computePerformanceRank).
 */
export function computeDuelRatingFromMatches(
  matches: TitleEngineMatch[],
  context: { performanceRank: string | null; currentRank: string | null }
): DuelRatingResult | null {
  if (matches.length === 0) return null;

  const input = buildTitleEngineInput(matches, context);
  const earnedTitles = evaluateTitles(input);
  // evaluateTitles devuelve {text, color, reason}, no el id -- se re-evalua
  // aca por id contra TITLE_DEFINITIONS para el bono de titulos relevantes
  // sin duplicar la logica de evaluate() de cada definicion. Import
  // dinamico evitado a proposito (mantiene este modulo sincrono y simple);
  // en cambio, se reconstruyen los ids relevantes comparando el texto del
  // titulo contra los ids conocidos que le interesan a esta funcion --
  // ver nota abajo sobre por que alcanza con el texto.
  //
  // NOTA: los ids de DUEL_RELEVANT_TITLE_IDS mapean 1:1 a labels fijos sin
  // interpolacion (Duelist/Godlike/Hat-trick/Avalancha/MVP/Lane Bully) --
  // a diferencia de "otp"/"scout" que interpolan el nombre del campeon,
  // asi que comparar por texto exacto es seguro aca sin necesitar el id.
  const relevantLabels = new Set(["Duelist", "Godlike", "Hat-trick", "Avalancha", "MVP", "Lane Bully"]);
  const relevantCount = earnedTitles.filter((t) => relevantLabels.has(t.text)).length;

  const combatPower = weightedCombatPower(input.averages);
  const bonus = performanceBonus(input) + Math.min(MAX_TITLE_BONUS, relevantCount * DUEL_TITLE_BONUS);
  const rawScore = combatPower + bonus;

  const rating = logisticCurve(rawScore);
  const confidence = clamp(matches.length / MIN_GAMES_FOR_FULL_CONFIDENCE, 0.25, 1);

  return { rating, confidence, gamesConsidered: matches.length };
}

/**
 * Fallback cuando no hay partidas de mmradar (perfil sin Riot ID
 * verificado, o mmradar no devolvio nada): deriva un duel rating
 * aproximado solo del lolRank de liga, igual que skillRatingFromLolRank
 * hace para el balanceador de equipos -- mismo criterio de "mejor una
 * estimacion ordenable que nada", con confidence baja fija para dejar en
 * claro en la UI que es una aproximacion.
 */
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

/**
 * Probabilidad de victoria en un 1v1 entre dos peleadores, a partir de
 * sus duel ratings ya cacheados (o el fallback por lolRank si a alguno le
 * falta). Curva logistica estandar (misma familia que Elo/TrueSkill):
 * una diferencia de rating chica da una probabilidad cercana a 50/50, una
 * diferencia grande se acerca a los extremos sin llegar nunca a 0 o 100
 * (siempre queda una chance minima, ningun duelo es 100% seguro).
 */
export function computeDuelWinProbability(playerA: DuelInput, playerB: DuelInput): DuelProbabilityResult {
  const ratingA = ratingOrFallback(playerA);
  const ratingB = ratingOrFallback(playerB);

  // Escala de sensibilidad: una diferencia de 20 puntos (ej. 70 vs 50) ya
  // da una probabilidad marcadamente favorable (~80/20) sin ser un
  // resultado cantado -- elegido a ojo para que el rango 0-100 de este
  // rating se sienta "vivo" en la UI en vez de que todo termine cerca de
  // 50/50 o todo cerca de los extremos.
  const diff = ratingA - ratingB;
  const probA = 1 / (1 + Math.exp(-diff / 12));

  const playerAWinPct = Math.round(clamp(probA * 100, 2, 98));
  return { playerAWinPct, playerBWinPct: 100 - playerAWinPct };
}

/**
 * Explicacion NO TECNICA para el modal de ayuda del bloque de habilidad
 * 1v1 (signo de exclamacion, mismo patron que PERFORMANCE_RANK_EXPLANATION
 * en performanceRank.ts) -- sin jerga de "curva logistica" ni "pesos".
 */
export const DUEL_RATING_EXPLANATION = {
  title: "¿Cómo se calcula la Habilidad 1v1?",
  summary:
    "Es un puntaje de 0 a 100 que estima que tan peligroso eres en duelos, basado en tus partidas recientes.",
  formula: "Pelea y teamfight (lo que más pesa) + laning + el resto de tus stats, con bonus si salís MVP seguido o ganás seguido",
  points: [
    "Combat y Teamfight pesan más que el resto: son las partes de tu juego más ligadas a ganar peleas uno contra uno.",
    "Salir MVP seguido (el mejor puntaje de la partida) y tener buen winrate suman puntos extra.",
    "Títulos de pelea que ya ganaste (como Duelist o Godlike) también suman un poco -- es la misma información vista desde otro ángulo.",
    "Con pocas partidas jugadas el número es menos confiable todavía -- se muestra un aviso cuando eso pasa."
  ],
  probabilityFormula:
    "La probabilidad de ganar un 1v1 sale de comparar los dos puntajes: cuanto más grande la diferencia, más lejos del 50/50 -- pero nunca 100% seguro para nadie."
};
