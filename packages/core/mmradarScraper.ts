/**
 * Consulta el perfil publico de un jugador en mmradar.gg via scraping del
 * HTML servidor (mismo enfoque que rankScraper.ts con LeagueOfGraphs: sin
 * navegador headless, solo fetch + parseo de texto).
 *
 * A diferencia de LeagueOfGraphs, mmradar.gg expone en el mismo HTML:
 * - Un "Performance Rank" (tier+division) separado del rango oficial de
 *   Riot — es un ranking propio de mmradar basado en desempeno real, no
 *   en LP.
 * - 6 scores individuales (Laning, Farming, Objectives, Combat, Teamfight,
 *   Vision) en escala 0-100 aprox, promedio de las ultimas partidas.
 * - Titulos otorgados por el sitio (ej. "OTP Kindred", "Duelist", "MVP").
 *
 * URL del perfil: https://mmradar.gg/summoner/{Nombre}-{Tag}
 * (el nombre de invocador va tal cual, con guion antes del tag; a
 * diferencia de LeagueOfGraphs, mmradar no fuerza minusculas en el path).
 */

export type MmradarLookupErrorReason =
  | "not_found"
  | "invalid_riot_id"
  | "source_unavailable"
  | "unexpected_format";

export class MmradarLookupError extends Error {
  reason: MmradarLookupErrorReason;
  constructor(reason: MmradarLookupErrorReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "MmradarLookupError";
  }
}

export interface MmradarPerformanceScores {
  laning: number;
  farming: number;
  objectives: number;
  combat: number;
  teamfight: number;
  vision: number;
}

export interface MmradarProfileResult {
  performanceRank: string;
  performanceScores: MmradarPerformanceScores | null;
  titles: string[];
}

/**
 * "OneShotOneKill#sigma" -> "OneShotOneKill-sigma". mmradar preserva
 * mayusculas del nombre (confirmado contra el HTML de ejemplo:
 * "/summoner/OneShotOneKill-sigma"), a diferencia del slug todo-minuscula
 * que exige LeagueOfGraphs.
 */
export function riotIdToMmradarSlug(lolUsername: string): string {
  const [gameName, tagLine] = lolUsername.split("#");
  if (!gameName || !tagLine) {
    throw new MmradarLookupError("invalid_riot_id", 'Formato invalido. Usa "NombreDeInvocador#TAG".');
  }
  return `${gameName.trim()}-${tagLine.trim()}`;
}

export function mmradarProfileUrl(lolUsername: string): string {
  const slug = riotIdToMmradarSlug(lolUsername);
  return `https://mmradar.gg/summoner/${slug}`;
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

function stripTags(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * El bloque de "Performance Rank" en el HTML de ejemplo se ve como:
 *   <h4 style="...">Performance<img ... data-tooltip="..."></h4>
 *   <p style="color: rgb(73, 177, 111);">EMERALD IV</p>
 * Se busca el marcador de texto "Performance" y se toma una ventana
 * despues de el, igual que rankScraper.ts hace con "Soloqueue" — por
 * patrones de texto, no por nombres de clase CSS (fragiles ante cambios
 * del sitio de terceros).
 */
function parsePerformanceRank(html: string): string | null {
  const marker = "Performance</h4>";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const window = html.slice(idx + marker.length, idx + marker.length + 300);
  const text = stripTags(window);

  const tierPattern = new RegExp(`\\b(${TIER_WORDS.join("|")})\\b\\s*(I{1,3}|IV)?`, "i");
  const match = text.match(tierPattern);
  if (!match) return null;

  const tier = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  const division = match[2] ? ` ${match[2].toUpperCase()}` : "";
  return `${tier}${division}`;
}

/**
 * Los 6 scores viven en <p id="player-average-{stat}-score" ...>N</p>
 * dentro de #total-average-stats — id's estables y explicitos en el HTML
 * de ejemplo, mas confiables que buscar por posicion/orden visual.
 */
function parsePerformanceScores(html: string): MmradarPerformanceScores | null {
  const keys: (keyof MmradarPerformanceScores)[] = [
    "laning",
    "farming",
    "objectives",
    "combat",
    "teamfight",
    "vision"
  ];

  const scores: Partial<MmradarPerformanceScores> = {};
  for (const key of keys) {
    const pattern = new RegExp(`id="player-average-${key}-score"[^>]*>(\\d+)<`, "i");
    const match = html.match(pattern);
    if (!match) return null;
    scores[key] = Number(match[1]);
  }

  return scores as MmradarPerformanceScores;
}

/**
 * Los titulos viven en <div id="player-titles"><p class="player-title
 * ..." data-tooltip="...">TEXTO</p>...</div>. Se extrae el texto interior
 * de cada <p class="player-title ...">, ignorando el tooltip.
 */
function parseTitles(html: string): string[] {
  const containerMatch = html.match(/id="player-titles">([\s\S]*?)<\/div>/);
  if (!containerMatch) return [];

  const container = containerMatch[1];
  const titleMatches = [...container.matchAll(/class="player-title[^"]*"[^>]*>([^<]+)</g)];
  return titleMatches.map((m) => m[1].trim()).filter((t) => t.length > 0);
}

const BROWSER_LIKE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
  Referer: "https://mmradar.gg/"
};

function isCloudflareChallenge(response: Response): boolean {
  const mitigated = response.headers.get("cf-mitigated");
  return mitigated !== null && mitigated.length > 0;
}

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
 * Fuente unica de verdad del perfil de mmradar, pensada para usarse desde
 * Astro Actions igual que fetchRankFromLeagueOfGraphs. No requiere API
 * key. Misma limitacion conocida que el scraper de LeagueOfGraphs: sitios
 * detras de Cloudflare pueden bloquear peticiones sin navegador real,
 * sobre todo desde IPs de datacenter (Cloudflare Workers) — cuando pasa,
 * se lanza "source_unavailable" en vez de fingir un resultado.
 */
export async function fetchMmradarProfile(lolUsername: string): Promise<MmradarProfileResult> {
  const url = mmradarProfileUrl(lolUsername);

  let response: Response;
  try {
    response = await fetch(url, { headers: BROWSER_LIKE_HEADERS });
  } catch (err) {
    throw new MmradarLookupError(
      "source_unavailable",
      `No se pudo conectar con mmradar.gg: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (response.status === 403 || response.status === 503 || isCloudflareChallenge(response)) {
    throw new MmradarLookupError(
      "source_unavailable",
      `mmradar.gg bloqueo la consulta (posible proteccion anti-bot, status ${response.status}).`
    );
  }

  if (response.status === 404) {
    throw new MmradarLookupError("not_found", "No encontramos ese Riot ID en mmradar.gg.");
  }
  if (!response.ok) {
    throw new MmradarLookupError(
      "source_unavailable",
      `mmradar.gg respondio con un error (${response.status}).`
    );
  }

  const html = await response.text();

  if (looksLikeChallengePage(html)) {
    throw new MmradarLookupError(
      "source_unavailable",
      "mmradar.gg bloqueo la consulta (proteccion anti-bot detectada en el contenido)."
    );
  }

  if (!html.includes("summoner-info") && !html.includes("Performance")) {
    throw new MmradarLookupError("not_found", "No encontramos ese Riot ID en mmradar.gg.");
  }

  try {
    const performanceRank = parsePerformanceRank(html);
    if (!performanceRank) {
      throw new MmradarLookupError(
        "unexpected_format",
        "mmradar.gg cambio su formato (no se encontro el Performance Rank)."
      );
    }

    return {
      performanceRank,
      performanceScores: parsePerformanceScores(html),
      titles: parseTitles(html)
    };
  } catch (err) {
    if (err instanceof MmradarLookupError) throw err;
    throw new MmradarLookupError(
      "unexpected_format",
      `mmradar.gg cambio su formato: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
