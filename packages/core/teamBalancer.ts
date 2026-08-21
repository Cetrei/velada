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

const MIN_BLOCK = 6;
const MAX_BLOCK = 10;

/**
 * Puntaje de una particion candidata para elegir la mejor: primero MENOS
 * sobrante (prioridad principal -- pedido del usuario: con 12 participantes
 * quiere que no quede nadie afuera), despues MENOS bloques (preferir dos
 * 3v3 en vez de tres 2v2... aunque 2v2 ni siquiera es valido, MIN_BLOCK=6
 * ya lo evita) y por ultimo bloques mas parejos entre si (mas cerca de 8,
 * que es el punto medio entre 6 y 10) para no mezclar un 3v3 gigante con
 * un 5v5 cuando hay una opcion mas pareja con el mismo sobrante.
 */
function scoreOf(partition: number[], total: number): [number, number, number] {
  const leftover = total - sum(partition);
  const blockCount = partition.length;
  const spread = sum(partition.map((b) => Math.abs(b - 8)));
  return [leftover, blockCount, spread];
}

function isBetter(candidate: number[], best: number[], total: number): boolean {
  const a = scoreOf(candidate, total);
  const b = scoreOf(best, total);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * Particiona `total` en bloques pares entre MIN_BLOCK (6, un 3v3) y
 * MAX_BLOCK (10, un 5v5), minimizando el sobrante -- por ejemplo con 12
 * devuelve [6, 6] (dos 3v3, 0 sobrante) en vez del viejo comportamiento
 * greedy que siempre tomaba el bloque de 10 primero si alcanzaba, dejando
 * un 5v5 + 2 personas sobrantes sin combate. Con empate en sobrante
 * prefiere menos bloques, y despues bloques mas parejos entre si (ver
 * scoreOf). DP acotado por MIN_BLOCK/MAX_BLOCK, trivial en tamaño para
 * cualquier cantidad realista de participantes.
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
