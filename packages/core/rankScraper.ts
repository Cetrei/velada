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
 * Headers que imitan un navegador real. LeagueOfGraphs esta detras de
 * Cloudflare, que puntua cada peticion por que tan "humana" parece — un
 * User-Agent solo no alcanza, Cloudflare tambien mira Accept/
 * Accept-Language/Referer y otras senales tipicas de un navegador (no un
 * cliente HTTP). Esto no garantiza pasar el challenge (el fingerprint TLS
 * de `fetch` sigue sin ser el de un navegador real, algo que ningun set de
 * headers puede arreglar), pero reduce las chances de bloqueo comparado
 * con mandar solo el User-Agent.
 */
const BROWSER_LIKE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
  Referer: "https://www.leagueofgraphs.com/"
};

/**
 * Cloudflare identifica sus propias respuestas de challenge con este
 * header (o variantes como "managed"/"active") en `cf-mitigated`. Cuando
 * esta presente, la respuesta no es el HTML del sitio real sin importar
 * el status code.
 */
function isCloudflareChallenge(response: Response): boolean {
  const mitigated = response.headers.get("cf-mitigated");
  return mitigated !== null && mitigated.length > 0;
}

/**
 * Deteccion por contenido para cuando Cloudflare (u otro WAF) responde 200
 * con la pagina de challenge en vez de headers claros. Busca las frases
 * que esas paginas usan casi siempre, en vez de asumir que cualquier HTML
 * corto es un challenge (un perfil real tambien puede ser HTML chico).
 */
function looksLikeChallengePage(html: string): boolean {
  const markers = [
    "Checking your browser",
    "cf-browser-verification",
    "Just a moment...",
    "cf_chl_opt",
    "Attention Required! | Cloudflare",
    "g-recaptcha",
    "cdn-cgi/challenge-platform"
  ];
  return markers.some((marker) => html.includes(marker));
}

/**
 * Fuente unica de verdad para el rango de un jugador, usada tanto por las
 * Astro Actions (saveOwnParticipant, lookupRank, checkRiotProfile) como
 * por el test de scripts/test-rank-scraper.ts. No requiere ninguna API key
 * — solo un fetch HTTP normal, disponible en Cloudflare Workers, `bun run`,
 * y `astro dev` por igual.
 *
 * IMPORTANTE (limitacion conocida): LeagueOfGraphs esta detras de
 * Cloudflare, que puede bloquear peticiones sin navegador real (fetch no
 * tiene el fingerprint TLS de Chrome ni ejecuta JS challenges) sobre todo
 * desde IPs de datacenter como las de un Cloudflare Worker. Cuando eso
 * pasa, esta funcion lanza "source_unavailable" en vez de dar un
 * resultado incorrecto — no hay forma de "arreglar" esto del lado del
 * codigo sin un servicio de browser rendering (pago) o un proxy
 * residencial; si el bloqueo se vuelve frecuente en produccion, esa es la
 * proxima decision a tomar con el usuario, no algo para resolver con mas
 * headers.
 */
export async function fetchRankFromLeagueOfGraphs(
  lolUsername: string,
  lolServer: string
): Promise<RankLookupResult | null> {
  const url = leagueOfGraphsProfileUrl(lolUsername, lolServer);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: BROWSER_LIKE_HEADERS
    });
  } catch (err) {
    throw new RankLookupError(
      "source_unavailable",
      `No se pudo conectar con la fuente de rango: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // LeagueOfGraphs esta detras de Cloudflare, y Cloudflare puede devolver
  // un 403/503 con una pagina de challenge ("Verificando que sos humano")
  // en vez del perfil, sobre todo desde IPs de datacenter (como las de un
  // Cloudflare Worker) que no tienen el trust score de un navegador real.
  // Esto NO significa que el Riot ID no exista — confundirlo con
  // not_found le haria creer al jugador que escribio mal su usuario
  // cuando en realidad la fuente lo bloqueo. Se distingue ANTES que
  // cualquier otro chequeo.
  if (response.status === 403 || response.status === 503 || isCloudflareChallenge(response)) {
    throw new RankLookupError(
      "source_unavailable",
      `La fuente de rango bloqueo la consulta (posible proteccion anti-bot, status ${response.status}).`
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

  // Un 200 todavia puede ser una pagina de challenge servida sin el status
  // 403/503 (Cloudflare a veces responde 200 con el HTML del challenge
  // interactivo). Se detecta por el contenido, no solo por el status code.
  if (looksLikeChallengePage(html)) {
    throw new RankLookupError(
      "source_unavailable",
      "La fuente de rango bloqueo la consulta (proteccion anti-bot detectada en el contenido)."
    );
  }

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
