/**
 * Tiers de League of Legends en el orden oficial. lolRank llega como texto
 * libre generado por fetchRiotRank en apps/web/src/actions/index.ts (ej.
 * "Diamond III", "Challenger", "Sin clasificar") — nunca escrito a mano por
 * el usuario, asi que el primer termino siempre matchea uno de estos tiers
 * o es el string exacto "Sin clasificar".
 */
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

/**
 * Extrae el tier ("Diamond") de un lolRank completo ("Diamond III"). Los
 * tiers Master+ no tienen division (son 1v1 elo puro), asi que el segundo
 * termino no siempre existe. Devuelve null para "Sin clasificar" o texto
 * no reconocido, en vez de asumir un tier por defecto.
 */
export function rankTierOf(lolRank: string | null | undefined): RankTier | null {
  if (!lolRank) return null;
  const firstWord = lolRank.trim().split(/\s+/)[0];
  return (RANK_TIERS as readonly string[]).includes(firstWord) ? (firstWord as RankTier) : null;
}

/**
 * Path publico (relativo a apps/web/public) del icono PNG de un tier.
 * Los archivos no vienen incluidos en el repo — hay que descargarlos de
 * https://leagueoflegends.fandom.com/wiki/Rank_(League_of_Legends) y
 * guardarlos en apps/web/public/images/ranks/ con estos nombres exactos
 * (minusculas, sin espacios): iron.png, bronze.png, silver.png, gold.png,
 * platinum.png, emerald.png, diamond.png, master.png, grandmaster.png,
 * challenger.png, unranked.png (para "Sin clasificar" / tier desconocido).
 */
export function rankIconPath(lolRank: string | null | undefined): string {
  const tier = rankTierOf(lolRank);
  return `/images/ranks/${tier ? tier.toLowerCase() : "unranked"}.png`;
}
