import type { MmradarPerformanceScores, MmradarTitle } from "./mmradarScraper";

/**
 * Motor de titulos PROPIO de este proyecto (no replica los de mmradar.gg
 * -- ese sitio los calcula 100% en el cliente via loadTitles.js a partir
 * de las mismas partidas que ya trae /load-matches, sin exponer ningun
 * campo de "MVP" o titulo explicito en el JSON; ver decision del usuario
 * 2026-08-20: en vez de adivinar sus reglas exactas, se arma un sistema
 * de titulos original con los mismos datos crudos que ya se consultan
 * aca -- partidas recientes con scores por categoria, campeon jugado, y
 * si el equipo gano).
 *
 * Diseño extensible a proposito: cada titulo es una entrada de
 * TITLE_DEFINITIONS con una funcion evaluate(input) -> boolean | null
 * (null = "no aplica, sin dato suficiente"). Agregar un titulo nuevo es
 * agregar una entrada a ese array; nunca hace falta tocar el resto del
 * motor. "input" ya trae los parametros mas usados pre-calculados
 * (promedios, mejor/peor score, tasa de victorias, campeon mas jugado,
 * etc.) para que una regla nueva rara vez necesite iterar matches a mano.
 */

export type TitleRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

/**
 * Color por rareza (no por titulo individual, a diferencia del color real
 * de mmradar que si era por-titulo): mismo criterio de "rareza visual"
 * que un juego con drops (comun = gris/verde apagado, legendario =
 * dorado). Devuelve el mismo shape {text, bg, border} que ya consume
 * resolveTitleColor en apps/web/src/lib/mmradarTitleColor.ts para que los
 * chips se pinten igual sin tocar ese componente.
 */
const RARITY_COLORS: Record<TitleRarity, { text: string; bg: string; border: string }> = {
  common: { text: "#a09b8c", bg: "rgba(160, 155, 140, 0.08)", border: "rgba(160, 155, 140, 0.3)" },
  uncommon: { text: "#49B16F", bg: "rgba(73, 177, 111, 0.08)", border: "rgba(73, 177, 111, 0.3)" },
  rare: { text: "#4FC3E8", bg: "rgba(79, 195, 232, 0.08)", border: "rgba(79, 195, 232, 0.3)" },
  epic: { text: "#a855f7", bg: "rgba(168, 85, 247, 0.08)", border: "rgba(168, 85, 247, 0.3)" },
  legendary: { text: "#C8AA6E", bg: "rgba(200, 170, 110, 0.12)", border: "rgba(200, 170, 110, 0.4)" }
};

export function colorForRarity(rarity: TitleRarity): { text: string; bg: string; border: string } {
  return RARITY_COLORS[rarity];
}

const SCORE_KEYS: (keyof MmradarPerformanceScores)[] = [
  "laning",
  "farming",
  "objectives",
  "combat",
  "teamfight",
  "vision"
];

/** Una partida reciente, ya reducida a lo que el motor necesita (ver mapMatchForTitleEngine en mmradarScraper.ts). */
export interface TitleEngineMatch {
  championName: string;
  scores: MmradarPerformanceScores & { total: number };
  won: boolean;
  /** true si tuvo el "total" mas alto de los 10 jugadores de esa partida puntual. */
  wasTopScoreInMatch: boolean;
}

/** Parametros ya derivados de las partidas, pensados para que una regla nueva no tenga que recalcular nada comun. */
export interface TitleEngineInput {
  matches: TitleEngineMatch[];
  gamesPlayed: number;
  wins: number;
  winRate: number;
  averages: MmradarPerformanceScores & { total: number };
  /** Mejor promedio entre los 6 stats (para reglas tipo "tu punto mas fuerte"). */
  bestStat: { key: keyof MmradarPerformanceScores; value: number };
  /** Peor promedio entre los 6 stats. */
  worstStat: { key: keyof MmradarPerformanceScores; value: number };
  mostPlayedChampion: { name: string; games: number; share: number } | null;
  mvpCount: number;
  /** performanceRank textual (ej. "Emerald IV"), si mmradar lo expuso -- null si no. */
  performanceRank: string | null;
  /** Rango oficial de Riot (Solo/Duo), si se pudo resolver. */
  currentRank: string | null;
}

export interface TitleDefinition {
  id: string;
  rarity: TitleRarity;
  /** Texto final del chip. Puede depender del input (ej. "OTP {Campeon}"). */
  label: (input: TitleEngineInput) => string;
  /** true = el jugador se gana este titulo con este input. null/false = no aplica. */
  evaluate: (input: TitleEngineInput) => boolean;
  /**
   * Explicacion concreta de por que se otorgo, con los numeros reales del
   * jugador (ej. "Combat 2140 y Teamfight 2310 de promedio en las ultimas
   * 8 partidas") -- pedido explicito del usuario: el hover de un titulo
   * tiene que mostrar el motivo, no solo el nombre. Solo se llama para
   * inputs que ya pasaron evaluate() (ver evaluateTitles), asi que puede
   * asumir con seguridad los mismos campos que evaluate() ya confirmo
   * que existen (mostPlayedChampion, performanceRank, etc.).
   */
  reason: (input: TitleEngineInput) => string;
}

function round(value: number): number {
  return Math.round(value);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Arma TitleEngineInput a partir de las partidas crudas. Separado de
 * evaluateTitles para que se pueda testear/reusar el calculo de
 * promedios sin correr las reglas, y porque varias reglas necesitan el
 * mismo input ya armado en vez de recalcularlo cada una.
 */
export function buildTitleEngineInput(
  matches: TitleEngineMatch[],
  extra: { performanceRank: string | null; currentRank: string | null }
): TitleEngineInput {
  const gamesPlayed = matches.length;
  const wins = matches.filter((m) => m.won).length;
  const winRate = gamesPlayed > 0 ? wins / gamesPlayed : 0;

  const averages = {
    laning: average(matches.map((m) => m.scores.laning)),
    farming: average(matches.map((m) => m.scores.farming)),
    objectives: average(matches.map((m) => m.scores.objectives)),
    combat: average(matches.map((m) => m.scores.combat)),
    teamfight: average(matches.map((m) => m.scores.teamfight)),
    vision: average(matches.map((m) => m.scores.vision)),
    total: average(matches.map((m) => m.scores.total))
  };

  let bestStat: { key: keyof MmradarPerformanceScores; value: number } = { key: "laning", value: -Infinity };
  let worstStat: { key: keyof MmradarPerformanceScores; value: number } = { key: "laning", value: Infinity };
  for (const key of SCORE_KEYS) {
    const value = averages[key];
    if (value > bestStat.value) bestStat = { key, value };
    if (value < worstStat.value) worstStat = { key, value };
  }

  const champCounts = new Map<string, number>();
  for (const m of matches) {
    champCounts.set(m.championName, (champCounts.get(m.championName) ?? 0) + 1);
  }
  let mostPlayedChampion: TitleEngineInput["mostPlayedChampion"] = null;
  for (const [name, games] of champCounts) {
    if (!mostPlayedChampion || games > mostPlayedChampion.games) {
      mostPlayedChampion = { name, games, share: gamesPlayed > 0 ? games / gamesPlayed : 0 };
    }
  }

  const mvpCount = matches.filter((m) => m.wasTopScoreInMatch).length;

  return {
    matches,
    gamesPlayed,
    wins,
    winRate,
    averages,
    bestStat,
    worstStat,
    mostPlayedChampion,
    mvpCount,
    performanceRank: extra.performanceRank,
    currentRank: extra.currentRank
  };
}

/**
 * Umbrales elegidos a ojo sobre la escala real de mmradar (scores
 * individuales suelen rondar 800-3000, ver ejemplos reales en el JSON de
 * /load-matches) -- no representan ningun corte oficial, son el criterio
 * propio de este proyecto y se pueden retocar libremente sin tocar el
 * resto del motor.
 */
const STRONG_STAT_THRESHOLD = 2000;
const ELITE_STAT_THRESHOLD = 2300;
const MIN_GAMES_FOR_OTP = 3;
const OTP_SHARE_THRESHOLD = 0.5;

export const TITLE_DEFINITIONS: TitleDefinition[] = [
  {
    id: "otp",
    rarity: "uncommon",
    label: (i) => `OTP ${i.mostPlayedChampion?.name ?? ""}`.trim(),
    evaluate: (i) =>
      i.gamesPlayed >= MIN_GAMES_FOR_OTP &&
      !!i.mostPlayedChampion &&
      i.mostPlayedChampion.share >= OTP_SHARE_THRESHOLD,
    reason: (i) =>
      `Jugaste ${i.mostPlayedChampion?.name ?? "tu campeon"} en ${i.mostPlayedChampion?.games ?? 0} de tus ultimas ${i.gamesPlayed} partidas (${pct(i.mostPlayedChampion?.share ?? 0)}).`
  },
  {
    id: "mvp",
    rarity: "rare",
    label: () => "MVP",
    evaluate: (i) => i.mvpCount >= 1 && i.gamesPlayed >= 1 && i.mvpCount / i.gamesPlayed >= 0.3,
    reason: (i) => `Tuviste el score total mas alto de las 10 en ${i.mvpCount} de tus ultimas ${i.gamesPlayed} partidas.`
  },
  {
    id: "hat-trick",
    rarity: "epic",
    label: () => "Hat-trick",
    evaluate: (i) => i.mvpCount >= 3,
    reason: (i) => `Fuiste MVP (mejor score de la partida) ${i.mvpCount} veces en tus ultimas ${i.gamesPlayed} partidas.`
  },
  {
    id: "duelist",
    rarity: "rare",
    label: () => "Duelist",
    evaluate: (i) => i.averages.combat >= STRONG_STAT_THRESHOLD && i.averages.teamfight >= STRONG_STAT_THRESHOLD,
    reason: (i) =>
      `Promedio de Combat ${round(i.averages.combat)} y Teamfight ${round(i.averages.teamfight)} en tus ultimas ${i.gamesPlayed} partidas.`
  },
  {
    id: "monopolist",
    rarity: "rare",
    label: () => "Monopolist",
    evaluate: (i) => i.averages.laning >= STRONG_STAT_THRESHOLD && i.averages.farming >= STRONG_STAT_THRESHOLD,
    reason: (i) =>
      `Promedio de Laning ${round(i.averages.laning)} y Farming ${round(i.averages.farming)} en tus ultimas ${i.gamesPlayed} partidas.`
  },
  {
    id: "strategic-mind",
    rarity: "rare",
    label: () => "Strategic Mind",
    evaluate: (i) => i.averages.objectives >= STRONG_STAT_THRESHOLD && i.averages.vision >= STRONG_STAT_THRESHOLD,
    reason: (i) =>
      `Promedio de Objectives ${round(i.averages.objectives)} y Vision ${round(i.averages.vision)} en tus ultimas ${i.gamesPlayed} partidas.`
  },
  {
    id: "avalanche",
    rarity: "epic",
    label: () => "Avalancha",
    evaluate: (i) => i.winRate >= 0.7 && i.gamesPlayed >= 5 && i.averages.combat >= STRONG_STAT_THRESHOLD,
    reason: (i) =>
      `${pct(i.winRate)} de winrate (${i.wins}/${i.gamesPlayed}) con Combat promedio ${round(i.averages.combat)} -- ganas arrasando.`
  },
  {
    id: "puppet-master",
    rarity: "epic",
    label: () => "Puppet Master",
    evaluate: (i) =>
      i.averages.objectives >= STRONG_STAT_THRESHOLD &&
      i.averages.teamfight >= STRONG_STAT_THRESHOLD &&
      i.averages.vision >= STRONG_STAT_THRESHOLD,
    reason: (i) =>
      `Promedio de Objectives ${round(i.averages.objectives)}, Teamfight ${round(i.averages.teamfight)} y Vision ${round(i.averages.vision)} -- controlas objetivos, peleas y mapa.`
  },
  {
    id: "warden",
    rarity: "uncommon",
    label: () => "Warden",
    evaluate: (i) => i.bestStat.key === "vision" && i.averages.vision >= STRONG_STAT_THRESHOLD,
    reason: (i) => `Vision (${round(i.averages.vision)}) es tu stat mas fuerte en promedio, por encima del resto.`
  },
  {
    id: "farm-machine",
    rarity: "uncommon",
    label: () => "Farm Machine",
    evaluate: (i) => i.bestStat.key === "farming" && i.averages.farming >= STRONG_STAT_THRESHOLD,
    reason: (i) => `Farming (${round(i.averages.farming)}) es tu stat mas fuerte en promedio, por encima del resto.`
  },
  {
    id: "lane-bully",
    rarity: "uncommon",
    label: () => "Lane Bully",
    evaluate: (i) => i.bestStat.key === "laning" && i.averages.laning >= STRONG_STAT_THRESHOLD,
    reason: (i) => `Laning (${round(i.averages.laning)}) es tu stat mas fuerte en promedio, por encima del resto.`
  },
  {
    id: "godlike",
    rarity: "legendary",
    label: () => "Godlike",
    evaluate: (i) => i.averages.total >= ELITE_STAT_THRESHOLD && i.winRate >= 0.6 && i.gamesPlayed >= 5,
    reason: (i) =>
      `Score total promedio ${round(i.averages.total)} con ${pct(i.winRate)} de winrate en tus ultimas ${i.gamesPlayed} partidas -- de otro nivel.`
  },
  {
    id: "consistent",
    rarity: "common",
    label: () => "Consistente",
    evaluate: (i) => {
      if (i.gamesPlayed < 5) return false;
      const totals = i.matches.map((m) => m.scores.total);
      const mean = average(totals);
      const variance = average(totals.map((t) => (t - mean) ** 2));
      const stdDev = Math.sqrt(variance);
      // Baja dispersion relativa al promedio: rinde parecido partida tras
      // partida, ni grandes picos ni grandes bajones.
      return mean > 0 && stdDev / mean < 0.15;
    },
    reason: (i) =>
      `Tu score total varia poco partida a partida (promedio ${round(i.averages.total)} en tus ultimas ${i.gamesPlayed}) -- rendis parecido siempre.`
  },
  {
    id: "underdog",
    rarity: "common",
    label: () => "Underdog",
    evaluate: (i) => {
      if (!i.performanceRank || !i.currentRank) return false;
      // Cuando performanceRank "suena" mejor que el rango oficial, se
      // interpreta como que el desempeno reciente va por delante del
      // rango que todavia no lo refleja. Comparacion por texto simple
      // (mismo orden de tiers que TIER_WORDS en mmradarScraper.ts) --
      // suficiente para esta regla, no hace falta un parser mas fino.
      const tierOrder = [
        "iron",
        "bronze",
        "silver",
        "gold",
        "platinum",
        "emerald",
        "diamond",
        "master",
        "grandmaster",
        "challenger"
      ];
      const tierIndex = (rank: string) =>
        tierOrder.findIndex((t) => rank.toLowerCase().includes(t));
      const perfIdx = tierIndex(i.performanceRank);
      const curIdx = tierIndex(i.currentRank);
      return perfIdx !== -1 && curIdx !== -1 && perfIdx > curIdx;
    },
    reason: (i) =>
      `Tu Performance Rank (${i.performanceRank}) va por delante de tu rango oficial (${i.currentRank}) -- tu nivel real todavia no se refleja ahi.`
  }
];

/**
 * Corre todas las TITLE_DEFINITIONS contra un input ya armado y devuelve
 * los titulos ganados, ordenados por rareza (legendary primero) para que
 * el chip mas vistoso quede primero en el render. Cada definicion nueva
 * agregada a TITLE_DEFINITIONS aparece aca automaticamente -- no hace
 * falta tocar esta funcion para agregar un titulo.
 */
const RARITY_ORDER: TitleRarity[] = ["legendary", "epic", "rare", "uncommon", "common"];

export function evaluateTitles(input: TitleEngineInput): MmradarTitle[] {
  const earned = TITLE_DEFINITIONS.filter((def) => def.evaluate(input));
  earned.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
  return earned.map((def) => ({
    text: def.label(input),
    color: colorForRarity(def.rarity).text,
    reason: def.reason(input)
  }));
}
