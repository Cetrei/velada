/**
 * Consulta el rango de un jugador scrapeando su perfil publico en
 * LeagueOfGraphs, en vez de usar la Riot API (RIOT_API_KEY dejo de usarse
 * para esto por completo, ver decision del usuario).
 *
 * Por que LeagueOfGraphs y no Mobalytics: Mobalytics es una SPA (React) —
 * el HTML que devuelve el servidor viene vacio, todo se pinta con JS en el
 * navegador, asi que un fetch normal (lo unico disponible en un Cloudflare
 * Worker, sin navegador headless) nunca ve el rango. LeagueOfGraphs, en
 * cambio, renderiza el rango directo en el HTML del servidor (confirmado
 * a mano contra un perfil real), asi que un fetch + parseo de texto
 * alcanza sin depender de ningun servicio de "browser rendering" pago.
 *
 * Formato de la URL: https://www.leagueofgraphs.com/summoner/{server}/{slug}
 * donde {slug} es "nombre-tag", todo el nombre en minusculas y el tag tal
 * cual (ej. "OneShotOneKill#sigma" -> "oneshotonekill-sigma").
 */

export const RANK_SOURCE_SERVERS: Record<string, string> = {
  LAN: "lan",
  LAS: "las",
  NA: "na",
  BR: "br",
  EUW: "euw",
  EUNE: "eune",
  KR: "kr",
  JP: "jp",
  OCE: "oce"
};

export type RankLookupErrorReason =
  | "not_found"
  | "invalid_riot_id"
  | "invalid_server"
  | "source_unavailable"
  | "unexpected_format";

export class RankLookupError extends Error {
  reason: RankLookupErrorReason;
  constructor(reason: RankLookupErrorReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "RankLookupError";
  }
}

export interface RankLookupResult {
  rank: string;
  leaguePoints: number;
  queue: "solo" | "flex";
}

/**
 * "OneShotOneKill#sigma" -> "oneshotonekill-sigma". El nombre va todo en
 * minusculas; el tag se preserva tal cual (LeagueOfGraphs es case-sensitive
 * para el tag en algunos casos regionales, asi que no lo forzamos).
 */
export function riotIdToLeagueOfGraphsSlug(lolUsername: string): string {
  const [gameName, tagLine] = lolUsername.split("#");
  if (!gameName || !tagLine) {
    throw new RankLookupError("invalid_riot_id", 'Formato invalido. Usa "NombreDeInvocador#TAG".');
  }
  return `${gameName.trim().toLowerCase()}-${tagLine.trim()}`;
}

export function leagueOfGraphsProfileUrl(lolUsername: string, lolServer: string): string {
  const serverKey = lolServer.trim().toUpperCase();
  const serverSlug = RANK_SOURCE_SERVERS[serverKey];
  if (!serverSlug) {
    throw new RankLookupError(
      "invalid_server",
      `Servidor "${lolServer}" no reconocido. Usa: ${Object.keys(RANK_SOURCE_SERVERS).join(", ")}.`
    );
  }
  const slug = riotIdToLeagueOfGraphsSlug(lolUsername);
  return `https://www.leagueofgraphs.com/summoner/${serverSlug}/${slug}`;
}

const TIER_WORDS = [
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
];

/**
 * El bloque de "Personal Ratings" en el HTML renderiza algo como:
 *   ... <div class="leagueTierBg ...">Platinum II</div> ...
 *   ... Soloqueue ...
 *   ... LP: 67 ...
 * en ese orden relativo, pero las clases/estructura exacta de
 * LeagueOfGraphs pueden cambiar con el tiempo (es un sitio de terceros que
 * no controlamos), asi que el parser busca por PATRONES DE TEXTO
 * (tier + numero romano, "Soloqueue", "LP: N") en vez de depender de
 * nombres de clase CSS especificos, que son mas fragiles.
 */
function extractQueueBlock(html: string, queueLabel: "Soloqueue" | "Ranked Flex"): string | null {
  const queueIndex = html.indexOf(queueLabel);
  if (queueIndex === -1) return null;
  // La info de tier/LP para esa cola aparece ANTES del label en el HTML de
  // LeagueOfGraphs (el label es el nombre de la cola, el tier esta en un
  // bloque hermano previo) — se toma una ventana razonable alrededor.
  const start = Math.max(0, queueIndex - 600);
  const end = Math.min(html.length, queueIndex + 400);
  return html.slice(start, end);
}

function stripTags(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTierFromBlock(block: string): { rank: string; leaguePoints: number } | null {
  const text = stripTags(block);

  if (/\bUnranked\b/i.test(text) && !TIER_WORDS.some((t) => text.includes(t))) {
    return null;
  }

  const tierPattern = new RegExp(`\\b(${TIER_WORDS.join("|")})\\b\\s*(I{1,3}|IV)?`, "i");
  const tierMatch = text.match(tierPattern);
  if (!tierMatch) return null;

  const tier = tierMatch[1].charAt(0).toUpperCase() + tierMatch[1].slice(1).toLowerCase();
  const division = tierMatch[2] ? ` ${tierMatch[2].toUpperCase()}` : "";

  const lpMatch = text.match(/LP:\s*(\d+)/i);
  const leaguePoints = lpMatch ? Number(lpMatch[1]) : 0;

  return { rank: `${tier}${division}`, leaguePoints };
}

/**
 * Busca el rango de solo/duo primero; si el jugador no tiene solo/duo pero
 * si flex, se usa flex como resultado (mejor mostrar algo real que nada).
 * Devuelve null (no lanza) cuando el perfil existe pero esta sin
 * clasificar en ambas colas — eso es un resultado valido, no un error.
 */
function parseRankFromHtml(html: string): RankLookupResult | null {
  const soloBlock = extractQueueBlock(html, "Soloqueue");
  if (soloBlock) {
    const parsed = parseTierFromBlock(soloBlock);
    if (parsed) return { ...parsed, queue: "solo" };
  }

  const flexBlock = extractQueueBlock(html, "Ranked Flex");
  if (flexBlock) {
    const parsed = parseTierFromBlock(flexBlock);
    if (parsed) return { ...parsed, queue: "flex" };
  }

  return null;
}

/**
 * Fuente unica de verdad para el rango de un jugador, usada tanto por las
 * Astro Actions (saveOwnParticipant, lookupRank, checkRiotProfile) como
 * por el test de scripts/test-rank-scraper.ts. No requiere ninguna API key
 * — solo un fetch HTTP normal, disponible en Cloudflare Workers, `bun run`,
 * y `astro dev` por igual.
 */
export async function fetchRankFromLeagueOfGraphs(
  lolUsername: string,
  lolServer: string
): Promise<RankLookupResult | null> {
  const url = leagueOfGraphsProfileUrl(lolUsername, lolServer);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        // Un User-Agent de navegador evita que el sitio devuelva una
        // pagina reducida/bloqueada para clientes sin UA (comportamiento
        // observado en varios sitios de stats de LoL).
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
      }
    });
  } catch (err) {
    throw new RankLookupError(
      "source_unavailable",
      `No se pudo conectar con la fuente de rango: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (response.status === 404) {
    throw new RankLookupError("not_found", "No encontramos ese Riot ID en ese servidor.");
  }
  if (!response.ok) {
    throw new RankLookupError(
      "source_unavailable",
      `La fuente de rango respondio con un error (${response.status}).`
    );
  }

  const html = await response.text();

  // LeagueOfGraphs devuelve 200 con una pagina "vacia" (sin perfil) cuando
  // el Riot ID no existe en ese servidor, en vez de un 404 real — se
  // detecta por la ausencia del bloque de nivel de invocador que solo
  // aparece en perfiles reales.
  if (!/Level\s+\d+/.test(html) && !html.includes("Personal Ratings")) {
    throw new RankLookupError("not_found", "No encontramos ese Riot ID en ese servidor.");
  }

  try {
    return parseRankFromHtml(html);
  } catch (err) {
    throw new RankLookupError(
      "unexpected_format",
      `La fuente de rango cambio su formato: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
