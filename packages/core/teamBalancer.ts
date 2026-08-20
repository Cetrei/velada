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

export function planTeamBlockSizes(total: number): number[] {
  if (total < 6) return [];

  const blocks: number[] = [];
  let remaining = total;

  while (remaining >= 6) {
    if (remaining === 7) {
      blocks.push(6);
      remaining -= 6;
      break;
    }
    if (remaining >= 10) {
      blocks.push(10);
      remaining -= 10;
    } else {
      // remaining es 6, 8 o 9 aca. 9 no es par -> se toma 8 y sobra 1.
      const block = remaining === 9 ? 8 : remaining;
      blocks.push(block);
      remaining -= block;
    }
  }

  return blocks;
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
