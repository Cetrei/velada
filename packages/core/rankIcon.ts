export const RANK_TIERS = [
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Emerald",
  "Diamond",
  "Master",
  "Grandmaster",
  "Challenger"
] as const;

export type RankTier = (typeof RANK_TIERS)[number];

export function rankTierOf(lolRank: string | null | undefined): RankTier | null {
  if (!lolRank) return null;
  const firstWord = lolRank.trim().split(/\s+/)[0];
  return (RANK_TIERS as readonly string[]).includes(firstWord) ? (firstWord as RankTier) : null;
}

export function rankIconPath(lolRank: string | null | undefined): string {
  const tier = rankTierOf(lolRank);
  return `/images/ranks/${tier ? tier.toLowerCase() : "unranked"}.png`;
}
