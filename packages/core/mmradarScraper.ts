/**
 * Consulta el perfil publico de un jugador en mmradar.gg via scraping del
 * HTML servidor (sin navegador headless, solo fetch + parseo de texto).
 * Fuente unica del rango de un jugador en este proyecto — ver decision
 * del usuario 2026-08-18: se elimino LeagueOfGraphs/rankScraper.ts por
 * completo, mmradar es lo unico que se consulta.
 *
 * mmradar.gg expone en el mismo HTML (confirmado contra un HTML real de
 * ejemplo del perfil "OneShotOneKill#sigma", LAN):
 * - Un "Current Rank" (tier+division+LP): el rango oficial de Riot
 *   (Solo/Duo), igual al que mostraria el cliente del juego. Es lo que se
 *   guarda como `lolRank`/rango "oficial" de cada peleador.
 *   <div id="current-rank" class="rank-box">...<h4>Current Rank</h4>
 *   <p>PLATINUM II <span class="rank-lp">(67LP)</span></p></div>
 * - Un "Performance Rank" (tier+division) separado: un ranking propio de
 *   mmradar basado en desempeno real reciente, no en LP.
 *   <div id="performance-rank" class="rank-box">...
 *   <h4>Performance<img ... data-tooltip="..."></h4>
 *   <p>EMERALD IV</p></div>
 * - 6 scores individuales (Laning, Farming, Objectives, Combat, Teamfight,
 *   Vision), escala real de cientos/miles (ej. 1780, 2220 -- NO 0-100,
 *   pese a lo que sugeria un comentario viejo de este archivo), promedio
 *   de las ultimas partidas. Viven en <p id="player-average-{stat}-score">.
 *   OJO: tambien existe un <p id="player-average-score"> (SIN sufijo de
 *   stat) que es el score total/general del jugador, no uno de los 6
 *   stats -- el patron de parsePerformanceScores exige el sufijo para no
 *   confundirlo con ese.
 * - Titulos otorgados por el sitio (ej. "OTP Kindred", "Duelist", "MVP"),
 *   en <div id="player-titles"><p class="player-title ...">TEXTO</p>...
 * - Icono de invocador: <img id="summoner-icon" src="...">, con el nivel
 *   como numero suelto al lado en <p id="summoner-level">574</p> (no se
 *   usa aca, solo el icono).
 * - Nombre + tag: <a id="summoner-name">OneShotOneKill<span
 *   id="summoner-tag"> #sigma</span></a> -- no se usa para nada (ya lo
 *   tenemos de lolUsername), documentado por completitud.
 * - Servidor/region: <p id="region">LAN</p>, junto al nombre.
 *
 * URL del perfil: https://mmradar.gg/summoner/{Nombre}-{Tag}
 * (el nombre de invocador va tal cual, con guion antes del tag; no exige
 * minusculas ni un servidor/region en la URL — mmradar resuelve la region
 * del lado de ellos).
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

export interface MmradarCurrentRank {
  rank: string;
  leaguePoints: number;
}

export interface MmradarProfileResult {
  currentRank: MmradarCurrentRank | null;
  performanceRank: string | null;
  performanceScores: MmradarPerformanceScores | null;
  titles: string[];
  /** URL del icono de invocador (id="summoner-icon"). null si no se encontro -- no es un error, el componente que lo consume simplemente no lo muestra. */
  iconUrl: string | null;
  /** Servidor/region tal como lo muestra mmradar junto al nombre (id="region", ej. "LAN"). null si no se encontro. */
  server: string | null;
}

/**
 * "OneShotOneKill#sigma" -> "OneShotOneKill-sigma". mmradar preserva
 * mayusculas del nombre (confirmado contra el HTML real:
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
 * El bloque de "Current Rank" en el HTML real se ve como:
 *   <div id="current-rank" class="rank-box">
 *     ...
 *     <h4>Current Rank</h4>
 *     <p style="color: rgb(30, 167, 191);">PLATINUM II <span class="rank-lp">(67LP)</span></p>
 *   </div>
 * Se ancla en "Current Rank</h4>" (con el cierre de tag) para no matchear
 * ninguna otra aparicion suelta del texto en la pagina. "Unranked" (sin
 * clasificar) es un resultado valido -> null, no un error.
 */
function parseCurrentRank(html: string): MmradarCurrentRank | null {
  const marker = "Current Rank</h4>";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const window = html.slice(idx + marker.length, idx + marker.length + 300);
  const text = stripTags(window);

  if (/\bUnranked\b/i.test(text) && !TIER_WORDS.some((t) => text.includes(t))) {
    return null;
  }

  const tierPattern = new RegExp(`\\b(${TIER_WORDS.join("|")})\\b\\s*(I{1,3}|IV)?`, "i");
  const match = text.match(tierPattern);
  if (!match) return null;

  const tier = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  const division = match[2] ? ` ${match[2].toUpperCase()}` : "";

  const lpMatch = text.match(/\((\d+)\s*LP\)/i);
  const leaguePoints = lpMatch ? Number(lpMatch[1]) : 0;

  return { rank: `${tier}${division}`, leaguePoints };
}

/**
 * El bloque de "Performance Rank" en el HTML real originalmente se veia
 * como:
 *   <div id="performance-rank" class="rank-box">
 *     ...
 *     <h4 style="...">Performance<img ... data-tooltip="..."></h4>
 *     <p style="color: rgb(73, 177, 111);">EMERALD IV</p>
 *   </div>
 * pero mmradar.gg cambio ese bloque (confirmado 2026-08-19 comparando
 * contra el HTML/markdown real de varios perfiles): el tier ya no aparece
 * como texto plano cerca del header "Performance" -- en su lugar hay una
 * imagen (badge visual del tier, ej. <img alt="Emerald" src="...">) antes
 * del header, seguida de "Recent Winrate"/"Account Health"/etc sin ningun
 * tier legible en texto. Se intenta primero el patron de texto original
 * (por si mmradar lo revierte o solo cambio para algunos perfiles), y si
 * no aparece se intenta un fallback leyendo el atributo alt/data-tooltip
 * de una imagen de badge cercana al marcador -- varios sitios ponen el
 * nombre del tier ahi aunque el texto visible sea solo el icono. Si
 * ninguno de los dos funciona, se devuelve null: el performance rank es
 * un dato SECUNDARIO/opcional (ver MmradarProfileResult), asi que su
 * ausencia no debe abortar el resto de la consulta (currentRank, scores,
 * titulos, icono siguen funcionando perfecto aunque este bloque haya
 * cambiado de formato del lado de mmradar).
 */
function parsePerformanceRank(html: string): string | null {
  const marker = "Performance</h4>";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const window = html.slice(idx + marker.length, idx + marker.length + 300);
  const text = stripTags(window);

  const tierPattern = new RegExp(`\\b(${TIER_WORDS.join("|")})\\b\\s*(I{1,3}|IV)?`, "i");
  const textMatch = text.match(tierPattern);
  if (textMatch) {
    const tier = textMatch[1].charAt(0).toUpperCase() + textMatch[1].slice(1).toLowerCase();
    const division = textMatch[2] ? ` ${textMatch[2].toUpperCase()}` : "";
    return `${tier}${division}`;
  }

  // Fallback: buscar el alt/data-tooltip de una imagen de badge en una
  // ventana ANTES del marcador (el badge visual aparece antes del header
  // "Performance" en el HTML actual, no despues).
  const beforeWindow = html.slice(Math.max(0, idx - 400), idx);
  const altPattern = new RegExp(`(?:alt|data-tooltip)="(${TIER_WORDS.join("|")})[^"]*"`, "i");
  const altMatch = beforeWindow.match(altPattern);
  if (altMatch) {
    return altMatch[1].charAt(0).toUpperCase() + altMatch[1].slice(1).toLowerCase();
  }

  return null;
}

/**
 * Los 6 scores viven en <p id="player-average-{stat}-score" ...>N</p> --
 * ids estables y explicitos en el HTML real, mas confiables que buscar
 * por posicion/orden visual. El patron exige el sufijo -{stat}- para no
 * matchear el <p id="player-average-score"> general (score total del
 * jugador, sin sufijo, que no es ninguno de los 6 stats individuales).
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

/**
 * El icono de invocador tiene un id explicito y estable en el HTML real:
 * <img id="summoner-icon" src="https://mmradar.fra1.cdn.digitaloceanspaces.com/.../5091.webp">
 * Se busca por ese id en vez de "la primera img del bloque de cabecera"
 * (fragil si el sitio agrega mas imagenes antes, como ya pasa con el
 * banner de fondo id="summoner-info-background-image" que aparece ANTES
 * en el HTML). null si no se encuentra -- no es un error, el componente
 * que consume esto simplemente no muestra el icono, sin dejar hueco.
 */
function parseIconUrl(html: string): string | null {
  const match = html.match(/id="summoner-icon"[^>]*src="([^"]+)"/i);
  return match ? match[1] : null;
}

/**
 * El servidor/region tiene su propio id explicito: <p id="region">LAN</p>.
 * Se busca por ese id (mas confiable que buscar texto de region conocido
 * en una ventana generica, que podia matchear falsos positivos en otra
 * parte de la pagina).
 */
function parseServer(html: string): string | null {
  const match = html.match(/id="region"[^>]*>([^<]+)</i);
  return match ? match[1].trim() : null;
}

/**
 * Marcadores textuales de "jugador no encontrado" que mmradar puede
 * devolver con un 200 (pagina normal con mensaje de error) o con un
 * status HTTP de error propio del sitio (no necesariamente 404) cuando la
 * Riot API no encuentra el Riot ID consultado -- confirmado que esto
 * pasaba mal clasificado como "source_unavailable" en vez de "not_found"
 * (bug real encontrado via bun run test:scrapping, ver fetchMmradarProfile
 * mas abajo). Se buscan por texto, no por status, porque el status por si
 * solo no alcanza para distinguir "no existe" de "la fuente esta caida".
 */
function looksLikeNotFoundPage(html: string): boolean {
  const markers = [
    "summoner not found",
    "player not found",
    "couldn't find",
    "could not find",
    "no summoner found",
    "we couldn't find this summoner",
    "account not found",
    "riot id not found"
  ];
  const lower = html.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
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
 * Fuente unica de verdad del perfil de un jugador en este proyecto
 * (rango oficial + performance + scores + titulos + icono + server),
 * pensada para usarse desde Astro Actions. No requiere API key.
 * Limitacion conocida: sitios detras de Cloudflare pueden bloquear
 * peticiones sin navegador real, sobre todo desde IPs de datacenter
 * (Cloudflare Workers) — cuando pasa, se lanza "source_unavailable" en
 * vez de fingir un resultado.
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

  // Bug real encontrado 2026-08-18 (bun run test:scrapping): para un Riot
  // ID inexistente mmradar NO siempre responde 404 -- puede devolver otro
  // status de error propio de su backend (ej. cuando la Riot API no
  // encuentra el nombre) cuyo body igual trae un mensaje de "no
  // encontrado" legible. Antes esto caia directo a "source_unavailable"
  // sin siquiera leer el body, lo cual es incorrecto: hay que inspeccionar
  // el contenido antes de rendirse a "fuente caida". Solo si el body NO
  // da ninguna senal de "no encontrado" se asume que es un error real de
  // la fuente.
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    if (looksLikeNotFoundPage(errorBody)) {
      throw new MmradarLookupError("not_found", "No encontramos ese Riot ID en mmradar.gg.");
    }
    if (looksLikeChallengePage(errorBody)) {
      throw new MmradarLookupError(
        "source_unavailable",
        "mmradar.gg bloqueo la consulta (proteccion anti-bot detectada en el contenido)."
      );
    }
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

  if (looksLikeNotFoundPage(html)) {
    throw new MmradarLookupError("not_found", "No encontramos ese Riot ID en mmradar.gg.");
  }

  try {
    // performanceRank es opcional: mmradar cambio su HTML y en muchos
    // perfiles ya no expone el tier como texto (ver comentario de
    // parsePerformanceRank). Antes esto abortaba TODA la consulta con
    // unexpected_format, tirando tambien el currentRank oficial que si
    // funciona perfecto -- ahora simplemente se guarda null y se sigue.
    return {
      currentRank: parseCurrentRank(html),
      performanceRank: parsePerformanceRank(html),
      performanceScores: parsePerformanceScores(html),
      titles: parseTitles(html),
      iconUrl: parseIconUrl(html),
      server: parseServer(html)
    };
  } catch (err) {
    if (err instanceof MmradarLookupError) throw err;
    throw new MmradarLookupError(
      "unexpected_format",
      `mmradar.gg cambio su formato: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
