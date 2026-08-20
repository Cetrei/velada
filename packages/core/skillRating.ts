import { RANK_TIERS, rankTierOf, type RankTier } from "./rankIcon";
import type { MmradarPerformanceScores } from "./mmradarScraper";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function skillRatingFromPerformanceScores(scores: MmradarPerformanceScores): number {
  return median([
    scores.laning,
    scores.farming,
    scores.objectives,
    scores.combat,
    scores.teamfight,
    scores.vision
  ]);
}

function divisionValue(lolRank: string): number {
  const match = lolRank.match(/\b(I{1,3}|IV)\b\s*$/);
  if (!match) return 0;
  switch (match[1]) {
    case "IV":
      return 0;
    case "III":
      return 1;
    case "II":
      return 2;
    case "I":
      return 3;
    default:
      return 0;
  }
}

export function skillRatingFromLolRank(lolRank: string | null | undefined): number {
  const tier = rankTierOf(lolRank);
  if (!tier) return 0;

  const tierIndex = RANK_TIERS.indexOf(tier as RankTier);
  const tierBase = tierIndex * 10;
  const divisionBonus = divisionValue(lolRank ?? "") * 2.5;

  return tierBase + divisionBonus;
}

export interface SkillRatingInput {
  performanceScores?: MmradarPerformanceScores | null;
  lolRank?: string | null;
}

export function computeSkillRating(input: SkillRatingInput): number {
  if (input.performanceScores) {
    return skillRatingFromPerformanceScores(input.performanceScores);
  }
  return skillRatingFromLolRank(input.lolRank);
}
