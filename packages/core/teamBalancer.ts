import { computeSkillRating, type SkillRatingInput } from "./skillRating";

export type TeamGenerationMode = "random" | "balanced" | "unfair";

export interface BalancerParticipant extends SkillRatingInput {
  id: string;
}

export interface GeneratedTeamMatch {
  teamAIds: string[];
  teamBIds: string[];
  teamARating: number;
  teamBRating: number;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// Formatos validos de LoL en custom: 3v3, 4v4 y 5v5 (equipo reducido de 3 o
// 4 sigue siendo una partida jugable con roles recortados; menos de 3 por
// equipo ya no lo es). MIN_BLOCK=6 (3v3), MAX_BLOCK=10 (5v5).
const MIN_BLOCK = 6;
const MAX_BLOCK = 10;

/**
 * Puntaje de una particion candidata para elegir la mejor -- pedido del
 * usuario 2026-08-21 (segunda vuelta, tras corregir mal la primera): (1)
 * MENOS sobrante ante todo -- nunca tomar un 5v5 si eso deja un resto que
 * no puede formar otro grupo valido (ej. con 13: tomar el 5v5 de entrada
 * deja 3 sueltos que no arman nada; en cambio 6+6 dejan solo 1 afuera).
 * Con empate en sobrante, (2) PRIORIZAR GRUPOS MAS GRANDES: menos bloques
 * primero (menos partidos, cada uno mas grande) y entre particiones con
 * igual cantidad de bloques, la que tenga el bloque mas grande primero
 * (se compara bloque a bloque, de mayor a menor, y gana la que tenga el
 * numero mas alto en la primera posicion donde difieren) -- asi con 16
 * elige [10, 6] (un 5v5 + un 3v3) en vez de [8, 8] (dos 4v4): ambas dejan
 * 0 sobrante y 2 bloques, pero [10, 6] tiene el grupo mas grande posible
 * primero.
 */
function scoreOf(partition: number[], total: number): { leftover: number; blockCount: number; sortedDesc: number[] } {
  return {
    leftover: total - sum(partition),
    blockCount: partition.length,
    sortedDesc: [...partition].sort((a, b) => b - a)
  };
}

function isBetter(candidate: number[], best: number[], total: number): boolean {
  const a = scoreOf(candidate, total);
  const b = scoreOf(best, total);

  if (a.leftover !== b.leftover) return a.leftover < b.leftover;
  if (a.blockCount !== b.blockCount) return a.blockCount < b.blockCount;

  for (let i = 0; i < a.sortedDesc.length; i++) {
    if (a.sortedDesc[i] !== b.sortedDesc[i]) return a.sortedDesc[i] > b.sortedDesc[i];
  }
  return false;
}

/**
 * Particiona `total` en bloques pares entre MIN_BLOCK (6, un 3v3) y
 * MAX_BLOCK (10, un 5v5), minimizando el sobrante ante todo y despues
 * priorizando grupos mas grandes (ver scoreOf/isBetter). DP acotada por
 * MIN_BLOCK/MAX_BLOCK, trivial en tamaño para cualquier cantidad realista
 * de participantes.
 *
 * Ejemplos: 12 -> [6, 6] (dos 3v3, 0 sobrante -- tomar un 5v5 dejaria 2
 * sueltos). 13 -> [6, 6] (0 sobrante en bloques + 1 suelto, mejor que
 * [10] con 3 sueltos). 16 -> [10, 6] (0 sobrante, grupo mas grande
 * posible primero). 20 -> [10, 10] (dos 5v5 completos).
 */
function bestPartition(total: number): number[] {
  if (total < MIN_BLOCK) return [];

  const memo = new Map<number, number[]>();

  function solve(n: number): number[] {
    if (n < MIN_BLOCK) return [];
    const cached = memo.get(n);
    if (cached) return cached;

    let best: number[] = [];
    for (let block = MIN_BLOCK; block <= Math.min(MAX_BLOCK, n); block += 2) {
      const rest = solve(n - block);
      const candidate = [block, ...rest].sort((a, b) => b - a);
      if (isBetter(candidate, best, total)) {
        best = candidate;
      }
    }

    memo.set(n, best);
    return best;
  }

  return solve(total);
}

export function planTeamBlockSizes(total: number): number[] {
  return bestPartition(total);
}

function ratingOf(p: BalancerParticipant): number {
  return computeSkillRating(p);
}

function balancedSplit(pool: BalancerParticipant[]): { teamA: BalancerParticipant[]; teamB: BalancerParticipant[] } {
  const sorted = [...pool].sort((a, b) => ratingOf(b) - ratingOf(a));
  const teamA: BalancerParticipant[] = [];
  const teamB: BalancerParticipant[] = [];

  let goesToA = true;
  let sinceFlip = 0;
  for (const p of sorted) {
    if (goesToA) teamA.push(p);
    else teamB.push(p);

    sinceFlip += 1;
    if (sinceFlip === 2) {
      goesToA = !goesToA;
      sinceFlip = 0;
    }
  }

  return { teamA, teamB };
}

function unfairSplit(pool: BalancerParticipant[]): { teamA: BalancerParticipant[]; teamB: BalancerParticipant[] } {
  const sorted = [...pool].sort((a, b) => ratingOf(b) - ratingOf(a));
  const half = sorted.length / 2;
  return { teamA: sorted.slice(0, half), teamB: sorted.slice(half) };
}

function randomSplit(pool: BalancerParticipant[]): { teamA: BalancerParticipant[]; teamB: BalancerParticipant[] } {
  const shuffled = shuffle(pool);
  const half = shuffled.length / 2;
  return { teamA: shuffled.slice(0, half), teamB: shuffled.slice(half) };
}

function splitBlock(
  pool: BalancerParticipant[],
  mode: TeamGenerationMode
): { teamA: BalancerParticipant[]; teamB: BalancerParticipant[] } {
  switch (mode) {
    case "balanced":
      return balancedSplit(pool);
    case "unfair":
      return unfairSplit(pool);
    case "random":
    default:
      return randomSplit(pool);
  }
}

export interface GenerateTeamMatchesResult {
  matches: GeneratedTeamMatch[];
  /** Participantes que no entraron en ningun bloque (sobra, o total < 6). */
  leftOverIds: string[];
}

export function generateTeamMatches(
  participants: BalancerParticipant[],
  mode: TeamGenerationMode
): GenerateTeamMatchesResult {
  const shuffledForBlocking = mode === "random" ? shuffle(participants) : [...participants];
  const blockSizes = planTeamBlockSizes(shuffledForBlocking.length);
  const matches: GeneratedTeamMatch[] = [];

  let cursor = 0;
  for (const size of blockSizes) {
    const block = shuffledForBlocking.slice(cursor, cursor + size);
    cursor += size;

    const { teamA, teamB } = splitBlock(block, mode);
    matches.push({
      teamAIds: teamA.map((p) => p.id),
      teamBIds: teamB.map((p) => p.id),
      teamARating: sum(teamA.map(ratingOf)),
      teamBRating: sum(teamB.map(ratingOf))
    });
  }

  const leftOverIds = shuffledForBlocking.slice(cursor).map((p) => p.id);

  return { matches, leftOverIds };
}
