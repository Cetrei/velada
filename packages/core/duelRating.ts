import type { MmradarPerformanceScores } from "./mmradarScraper";
import type { TitleEngineMatch, TitleEngineInput } from "./titleEngine";
import { buildTitleEngineInput, evaluateTitles } from "./titleEngine";
import { skillRatingFromLolRank } from "./skillRating";

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

const CURVE_MIDPOINT = 1750;
const CURVE_STEEPNESS = 0.0022;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function weightedCombatPower(scores: MmradarPerformanceScores): number {
  return (Object.keys(STAT_WEIGHTS) as (keyof MmradarPerformanceScores)[]).reduce(
    (sum, key) => sum + scores[key] * STAT_WEIGHTS[key],
    0
  );
}

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
  // sin duplicar la logica de evaluate() de cada definicion. 
  const relevantLabels = new Set(["Duelist", "Godlike", "Hat-trick", "Avalancha", "MVP", "Lane Bully"]);
  const relevantCount = earnedTitles.filter((t) => relevantLabels.has(t.text)).length;

  const combatPower = weightedCombatPower(input.averages);
  const bonus = performanceBonus(input) + Math.min(MAX_TITLE_BONUS, relevantCount * DUEL_TITLE_BONUS);
  const rawScore = combatPower + bonus;

  const rating = logisticCurve(rawScore);
  const confidence = clamp(matches.length / MIN_GAMES_FOR_FULL_CONFIDENCE, 0.25, 1);

  return { rating, confidence, gamesConsidered: matches.length };
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
