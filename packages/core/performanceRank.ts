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
 * total: un perfil con promedio 1860 aparecia como "Diamond II"/"Emerald
 * IV" (segun la captura) y otro con promedio ~1894 (34 puntos mas, casi
 * identico) aparecia como "Challenger" -- el tier mas alto posible. Eso
 * descarta un corte lineal fijo sobre el promedio; tiene que estar
 * pesando algo mas (winrate, consistencia, LP, comparacion contra la
 * poblacion de jugadores, etc.) que este proyecto no puede ver ni
 * replicar exactamente.
 *
 * Decision del usuario (2026-08-20): en vez de perseguir una formula que
 * no se puede observar, se calcula un Performance Rank PROPIO usando los
 * mismos datos crudos que ya se consultan aca (ver fetchRawMatches en
 * mmradarScraper.ts) -- promedio total, winrate, y consistencia
 * (desviacion estandar) de las ultimas partidas. No pretende replicar el
 * numero exacto de mmradar, solo dar una seña razonable y explicable con
 * la misma forma de tier+division que ya usa el resto del sitio.
 *
 * Recalibrado 2026-08-20 (sesion de refinamiento con 2 perfiles reales de
 * referencia provistos por el usuario):
 * - Perfil A (el propio usuario): promedios Laning 1910 / Farming 1814 /
 *   Objectives 1330 / Combat 2227 / Teamfight 2056 / Vision 2025 -> total
 *   promedio ~11362/6 stats = 1893.67 POR STAT, o 11362 SUMADO (ver nota
 *   de escala abajo). Recent winrate 63% (19G 12W 7L), Account Health 82,
 *   titulos Scout/Duelist/Monopolist/MVP -- perfil de MVP frecuente y
 *   alto rendimiento sostenido. Rango oficial mostrado: Challenger
 *   (2794LP). Se calibra para que este perfil dé Challenger tambien en
 *   Performance.
 * - Perfil B (OneShotOneKill#sigma, challenger de referencia del
 *   usuario): promedios Laning 1780 / Farming 1799 / Objectives 1550 /
 *   Combat 2220 / Teamfight 2037 / Vision 1773, recent winrate tambien
 *   63% (19G 12W 7L) pero Account Health mas bajo (71 vs 82), rango
 *   oficial Platinum II (67LP) -- MUY por debajo del rango oficial de A.
 *   Total sumado ~10959-11156 segun la captura. Performance mostrado por
 *   mmradar.gg para un snapshot de esta cuenta: "Diamond II" (imagen del
 *   panel propio del sitio, total 1860 ahi referido como promedio
 *   ponderado, no suma). Se calibra para que quede claramente por debajo
 *   del perfil A pero todavia en el tramo alto (Diamond), reflejando que
 *   el promedio de scores es fuerte pero el rango oficial/LP y el account
 *   health son mas bajos.
 *
 * IMPORTANTE sobre la escala: fetchRawMatches/mmradar exponen los 6
 * scores en la escala "por stat" (cientos/miles, ej. Laning ~1780-1910),
 * y esta funcion trabaja sobre la SUMA de los 6 (avgTotal), no el
 * promedio por stat -- coherente con como ya lo usaba el resto de este
 * archivo antes de este recalibrado (totalOf sigue sumando los 6 keys).
 * Los umbrales de abajo estan expresados en esa misma escala sumada
 * (rango real observado ~9000-13500 sumando 6 stats de ~1300-2400 cada
 * uno).
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
 * Umbrales de promedio TOTAL (suma de los 6 stats, escala real
 * ~9000-13500 segun los 2 perfiles de referencia del usuario) para el
 * tier BASE, antes de aplicar los ajustes de winrate/consistencia.
 * Repartidos para que el promedio sumado del Perfil A (~11362) ya caiga
 * directo en el umbral de Challenger, y el del Perfil B (~11159, ~200
 * puntos menos) quede un par de tiers mas abajo (Master/Diamond alto) --
 * la banda Master/Grandmaster/Challenger se dejo deliberadamente angosta
 * (apenas 350 puntos de ancho combinado) porque en la realidad tambien
 * son los tiers con menos poblacion/mas comprimidos. No representan
 * ningun corte oficial de mmradar ni de Riot -- es el criterio propio de
 * este proyecto, ajustable libremente sin tocar el resto del calculo.
 */
const TIER_THRESHOLDS: { tier: RankTier; minTotal: number }[] = [
  { tier: "Iron", minTotal: 0 },
  { tier: "Bronze", minTotal: 5400 },
  { tier: "Silver", minTotal: 6600 },
  { tier: "Gold", minTotal: 7800 },
  { tier: "Platinum", minTotal: 9000 },
  { tier: "Emerald", minTotal: 9900 },
  { tier: "Diamond", minTotal: 10650 },
  { tier: "Master", minTotal: 11000 },
  { tier: "Grandmaster", minTotal: 11200 },
  { tier: "Challenger", minTotal: 11350 }
];

/**
 * Cuantos "escalones" (division dentro de tier, IV->I = 1 escalon cada
 * una, y de tier a tier tambien cuenta como escalones para Master+ sin
 * division) puede mover el ajuste de winrate/consistencia el tier base.
 * Es lo que explica el salto grande observado entre los 2 perfiles de
 * referencia (promedios sumados a ~200 puntos de distancia, pero uno
 * queda en Diamond y el otro en Challenger): el perfil A tiene mejor
 * Account Health (82 vs 71) y un rango oficial mucho mas alto (Challenger
 * 2794LP vs Platinum II 67LP) pese al mismo 63% de winrate reciente en
 * ambos -- el ajuste de consistencia (bajo Account Health = rendimiento
 * mas erratico partida a partida) es lo que hace la diferencia real aca,
 * no el winrate (que es identico en los 2 ejemplos).
 */
const MAX_ADJUSTMENT_STEPS = 9;

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
 *
 * Peso subido en el recalibrado 2026-08-20 (de +-1.5 a +-4.5 escalones):
 * los 2 perfiles de referencia tienen el MISMO winrate reciente (63%,
 * 19G 12W 7L) pero terminan en tiers de Performance muy distintos
 * (Challenger vs Diamond) -- el unico otro factor observable que los
 * distingue es que uno rinde mas parejo partida a partida (Account
 * Health 82) que el otro (Account Health 71). Sin subir este peso, el
 * calculo no podia explicar esa diferencia real usando solo los datos
 * que este proyecto puede consultar.
 */
function consistencyAdjustment(matches: TitleEngineMatch[]): number {
  if (matches.length < 4) return 0;
  const totals = matches.map((m) => m.scores.total);
  const mean = average(totals);
  if (mean <= 0) return 0;
  const variance = average(totals.map((t) => (t - mean) ** 2));
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  // 0.10 (muy consistente) -> +4.5 escalones; 0.30+ (erratico) -> -4.5
  const centered = 0.2 - coefficientOfVariation; // positivo = mas consistente que el punto neutro
  return Math.max(-4.5, Math.min(4.5, centered * 22.5));
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
  const nextMin = TIER_THRESHOLDS[baseTierIndex + 1]?.minTotal ?? currentMin + 600;
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

/**
 * Explicacion NO TECNICA de como se arma el Performance Rank, pensada
 * para el modal de ayuda (signo de exclamacion junto al bloque de
 * Performance en MmradarPerformanceCard/MmradarPanel) -- formula
 * simplificada, sin jerga de "coeficiente de variacion" ni "escalones
 * clamped". Compartido entre el modal de Performance y cualquier otro
 * lugar que quiera mostrar el mismo texto sin duplicarlo.
 */
export const PERFORMANCE_RANK_EXPLANATION = {
  title: "¿Cómo se calcula el Performance Rank?",
  summary:
    "Es un rango propio de este sitio (no el que muestra mmradar.gg) basado en tus últimas partidas: qué tan bien jugás en promedio, qué tan seguido ganás, y qué tan parejo rendís partida a partida.",
  formula: "Rango base (por tu promedio) + ajuste por winrate + ajuste por consistencia",
  points: [
    "Promedio: se suman tus 6 scores (Laning, Farming, Objectives, Combat, Teamfight, Vision) de cada partida y se promedia sobre tus últimas partidas — esto define el rango base.",
    "Winrate: ganar seguido te sube de rango, perder seguido te baja. Hace falta un mínimo de partidas para que esto pese.",
    "Consistencia: rendir parecido partida a partida (sin picos ni bajones grandes) suma; ser errático resta.",
    "Con promedios muy parecidos, dos jugadores pueden terminar en rangos distintos si uno gana más seguido o juega más parejo que el otro — así se explica que un promedio similar no siempre da el mismo rango."
  ]
};
