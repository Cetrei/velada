import type { MmradarPerformanceScores, MmradarTitle } from "./mmradarScraper";

export type TitleRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

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
  /**
   * Fraccion del total combinado de SU EQUIPO (los 5, el jugador incluido)
   * que aporto el jugador en esa partida puntual -- own.total / sum(team.total).
   * 0.2 = aporte parejo (1/5 exacto, ni carry ni carga). Distinto de
   * wasTopScoreInMatch (que compara contra los 10, no solo el propio
   * equipo): esta variable es la señal de "cuanto se gano/perdio gracias a
   * el" dentro de su propio equipo, ver performanceRank.ts. null si la
   * partida no traia scores de los 4 companeros de equipo (dato
   * incompleto de mmradar para esa partida puntual).
   */
  teamShare: number | null;
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

const STRONG_STAT_THRESHOLD = 1700;
const ELITE_STAT_THRESHOLD = 2000;
const MIN_GAMES_FOR_OTP = 3;
const OTP_SHARE_THRESHOLD = 0.5;
/** Opuesto de OTP: pool amplio de campeones, ningun campeon domina tus partidas. */
const MIN_GAMES_FOR_SCOUT = 5;
const SCOUT_MAX_CHAMPION_SHARE = 0.3;

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
    id: "scout",
    rarity: "uncommon",
    label: () => "Scout",
    evaluate: (i) => {
      if (i.gamesPlayed < MIN_GAMES_FOR_SCOUT || !i.mostPlayedChampion) return false;
      return i.mostPlayedChampion.share <= SCOUT_MAX_CHAMPION_SHARE;
    },
    reason: (i) => {
      const distinctChamps = new Set(i.matches.map((m) => m.championName)).size;
      return `Jugaste ${distinctChamps} campeones distintos en tus ultimas ${i.gamesPlayed} partidas, ninguno paso el ${Math.round(SCOUT_MAX_CHAMPION_SHARE * 100)}% -- pool amplio, te adaptas al draft.`;
    }
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
