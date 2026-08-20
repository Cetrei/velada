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

import type { TitleEngineMatch } from "./titleEngine";
import { buildTitleEngineInput, evaluateTitles } from "./titleEngine";
import { computePerformanceRank } from "./performanceRank";

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

/**
 * Un titulo otorgado por mmradar (ej. "OTP Kindred", "Duelist", "MVP")
 * junto con su color, si el HTML lo trae. mmradar le pone a cada chip de
 * titulo un color propio (visible en la referencia del usuario: azul,
 * magenta, verde, dorado) -- se intenta leer ese color real del HTML
 * (style inline en el propio <p class="player-title">, mismo patron que
 * ya usa parseCurrentRank/parsePerformanceRank para leer
 * style="color: rgb(...)"). Si el HTML no trae color para ese titulo
 * puntual, color queda null: quien consuma esto (MmradarPanel,
 * PerformancePreviewCard) decide como resolver la falta de color (nunca
 * aca, este modulo solo scrapea lo que hay).
 */
export interface MmradarTitle {
  text: string;
  color: string | null;
  /**
   * Por que se otorgo el titulo, con los numeros reales del jugador (ej.
   * "Combat 2140 y Teamfight 2310 de promedio") -- pedido explicito del
   * usuario 2026-08-20: el hover de un titulo tiene que explicar el
   * motivo, no solo mostrar el nombre. Los titulos que vienen del motor
   * propio (ver titleEngine.ts, TITLE_DEFINITIONS[].reason) siempre traen
   * esto poblado; queda null solo para titulos de meme
   * (participant.memeTitles, ver MmradarPanel.tsx) que no pasan por el
   * motor y no tienen un motivo real que mostrar.
   */
  reason: string | null;
}

export interface MmradarProfileResult {
  currentRank: MmradarCurrentRank | null;
  performanceRank: string | null;
  performanceScores: MmradarPerformanceScores | null;
  titles: MmradarTitle[];
  /** URL del icono de invocador (id="summoner-icon"). null si no se encontro -- no es un error, el componente que lo consume simplemente no lo muestra. */
  iconUrl: string | null;
  /** Servidor/region tal como lo muestra mmradar junto al nombre (id="region", ej. "LAN"). null si no se encontro. */
  server: string | null;
  /** Nivel de invocador (id="summoner-level", numero suelto al lado del icono). null si no se encontro. */
  level: number | null;
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
 * Los 6 scores viven en <p id="player-average-{stat}-score" ...>N</p> en
 * el HTML servidor -- ids estables y explicitos, en teoria mas confiables
 * que buscar por posicion/orden visual. El patron exige el sufijo
 * -{stat}- para no matchear el <p id="player-average-score"> general
 * (score total del jugador, sin sufijo, que no es ninguno de los 6 stats
 * individuales).
 *
 * Bug real reportado 2026-08-19 (captura del usuario: /inscripcion
 * detectaba el rango bien -- "Perfil encontrado -- Platinum II" -- pero
 * las 6 barras de performance y el total se quedaban en "Sin datos aun").
 * Causa CONFIRMADA 2026-08-20 con el propio "Ver codigo fuente" (HTML
 * crudo real, lo unico que fetch() puede ver) que el usuario pegó en el
 * chat: los <p id="player-average-{stat}-score"> existen en el HTML pero
 * estan VACIOS (`<p id="player-average-laning-score"
 * class="player-average-score"></p>`, sin numero adentro), dentro de un
 * bloque `<div id="first-loader" style="display:none">` -- mmradar
 * rellena estos 6 numeros con JS del lado del cliente despues de cargar,
 * ya no vienen en absoluto en lo que el servidor manda. Confirmado que
 * NINGUN ajuste de regex sobre el HTML puede recuperarlos: el dato
 * simplemente no esta ahi. Esta funcion se deja SIN USAR en
 * fetchMmradarProfile (nunca devuelve nada distinto de null en la
 * practica actual) pero no se borra: sirve de documentacion de que se
 * intento y por que no alcanza, y por si mmradar en algun momento vuelve
 * a exponerlos aca. La fuente real de estos 6 numeros ahora es
 * fetchMatchScores() mas abajo (endpoint /load-matches).
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
  let foundAny = false;
  for (const key of keys) {
    const pattern = new RegExp(`id="player-average-${key}-score"[^>]*>(\\d+)<`, "i");
    const match = html.match(pattern);
    if (match) {
      scores[key] = Number(match[1]);
      foundAny = true;
    } else {
      scores[key] = 0;
    }
  }

  return foundAny ? (scores as MmradarPerformanceScores) : null;
}

interface LoadMatchesParticipant {
  isPlayer: boolean;
  championName?: string;
  teamId?: number;
  scores?: {
    laning: number;
    farming: number;
    objectives: number;
    combat: number;
    teamfight: number;
    vision: number;
    total: number;
  };
}

interface LoadMatchesMatch {
  matchId: string;
  winningTeam?: number;
  participants: LoadMatchesParticipant[];
}

/**
 * El HTML servidor no trae los 6 scores individuales (ver comentario de
 * parsePerformanceScores arriba) -- mmradar los pinta con JS del lado
 * del cliente. Ese JS los saca de este endpoint interno, confirmado
 * 2026-08-20 inspeccionando la pestana Network del navegador del usuario
 * mientras cargaba un perfil real:
 *   POST https://mmradar.gg/load-matches
 *   Content-Type: application/json
 *   { "matchId": null, "mode": "solo", "riotGameName": "...",
 *     "riotTagLine": "..." }
 * Devuelve un array de partidas recientes, cada una con `participants[]`
 * (10 jugadores); el jugador consultado tiene `isPlayer: true` y trae sus
 * `scores` de ESA partida puntual (no un promedio). El promedio que
 * muestra el perfil se calcula sumando/promediando estos 6 numeros sobre
 * todas las partidas devueltas -- eso es lo que hace esta funcion.
 *
 * OJO -- distinto en naturaleza al resto de este archivo: `/load-matches`
 * es un endpoint interno no documentado publicamente (a diferencia del
 * HTML de `/summoner/...`, que es la pagina publica que cualquiera ve).
 * Decision explicita del usuario 2026-08-20: usarlo de todos modos porque
 * es la unica via gratuita sin cambiar de arquitectura (la alternativa,
 * un navegador headless, no corre en Cloudflare Workers y tiene costo
 * real). Riesgo aceptado y conocido: si mmradar cambia este endpoint
 * (nombre, forma, o le agrega auth/rate-limit) esto deja de funcionar sin
 * aviso previo, mas fragil que el HTML publico que si es una superficie
 * que ellos mantienen estable a proposito. Nunca lanza: mismo criterio
 * que fetchMmradarData en actions/index.ts, es una fuente
 * opcional/secundaria (currentRank/icono/nivel/titulos del HTML publico
 * siguen funcionando aunque esto falle), asi que un fallo aca no debe
 * romper el resto de la consulta -- solo loguea y devuelve null.
 */
interface RawMatchesResult {
  averageScores: MmradarPerformanceScores;
  /** Partidas ya reducidas al shape que necesita titleEngine.ts (ver TitleEngineMatch). */
  engineMatches: TitleEngineMatch[];
}

/**
 * Ademas del promedio (ver comentario original mas abajo), esta funcion
 * ahora tambien arma TitleEngineMatch[] para el motor de titulos propio
 * (packages/core/titleEngine.ts) -- mismo POST a /load-matches, un solo
 * fetch cubre ambas necesidades en vez de pegarle dos veces al mismo
 * endpoint. "wasTopScoreInMatch" (insumo de la regla MVP del motor) se
 * calcula comparando el total del jugador contra los otros 9
 * participantes de esa partida puntual, ya presentes en el mismo payload.
 */
async function fetchRawMatches(gameName: string, tagLine: string): Promise<RawMatchesResult | null> {
  try {
    const response = await fetch("https://mmradar.gg/load-matches", {
      method: "POST",
      headers: { ...BROWSER_LIKE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ matchId: null, mode: "solo", riotGameName: gameName, riotTagLine: tagLine })
    });

    if (!response.ok) {
      console.error(`mmradar /load-matches respondio ${response.status} para ${gameName}#${tagLine}`);
      return null;
    }

    const matches = (await response.json()) as LoadMatchesMatch[];
    if (!Array.isArray(matches) || matches.length === 0) return null;

    const keys: (keyof MmradarPerformanceScores)[] = [
      "laning",
      "farming",
      "objectives",
      "combat",
      "teamfight",
      "vision"
    ];
    const totals: Record<keyof MmradarPerformanceScores, number> = {
      laning: 0,
      farming: 0,
      objectives: 0,
      combat: 0,
      teamfight: 0,
      vision: 0
    };
    let gamesCounted = 0;
    const engineMatches: TitleEngineMatch[] = [];

    for (const match of matches) {
      const player = match.participants?.find((p) => p.isPlayer);
      if (!player?.scores) continue;
      for (const key of keys) totals[key] += player.scores[key];
      gamesCounted += 1;

      const highestTotal = Math.max(...match.participants.map((p) => p.scores?.total ?? -Infinity));
      engineMatches.push({
        championName: player.championName ?? "?",
        scores: {
          laning: player.scores.laning,
          farming: player.scores.farming,
          objectives: player.scores.objectives,
          combat: player.scores.combat,
          teamfight: player.scores.teamfight,
          vision: player.scores.vision,
          total: player.scores.total
        },
        won: typeof match.winningTeam === "number" && player.teamId === match.winningTeam,
        wasTopScoreInMatch: player.scores.total >= highestTotal
      });
    }

    if (gamesCounted === 0) return null;

    const averageScores = {} as MmradarPerformanceScores;
    for (const key of keys) averageScores[key] = Math.round(totals[key] / gamesCounted);
    return { averageScores, engineMatches };
  } catch (err) {
    console.error(`fetchRawMatches fallo para ${gameName}#${tagLine}:`, err);
    return null;
  }
}

/**
 * Los titulos viven en <div id="player-titles"><p class="player-title
 * ..." data-tooltip="...">TEXTO</p>...</div>. Se extrae el texto interior
 * de cada <p class="player-title ...">, ignorando el tooltip.
 *
 * Color real (pedido explicito del usuario 2026-08-19, para no inventar
 * colores que no vienen de mmradar): cada <p class="player-title"> puede
 * traer su propio style inline (mismo patron ya usado por
 * parseCurrentRank/parsePerformanceRank para leer "color: rgb(r, g, b)"
 * de un style inline). Se busca ese patron DENTRO del tag de apertura del
 * propio <p> (no en una ventana generica alrededor, para no capturar el
 * color de un titulo vecino) y se convierte a hex para que los
 * consumidores (MmradarPanel, PerformancePreviewCard) no tengan que lidiar
 * con el formato rgb(). Si un titulo puntual no trae style de color en el
 * HTML, color queda null -- no se rellena con un valor inventado aca, eso
 * queda a criterio del componente que lo consume (ver colorForTitle en
 * apps/web/src/lib/mmradarTitleColor.ts, que sirve como fallback visual
 * SOLO cuando este color es null, nunca lo reemplaza si vino de la
 * fuente).
 */
/**
 * Los titulos viven en un contenedor con id="player-titles", cada uno como
 * un <p class="player-title ..." data-tooltip="...">TEXTO</p>. Se extrae
 * el texto interior de cada uno, ignorando el tooltip.
 *
 * Color real: confirmado 2026-08-20 contra el HTML real que mando el
 * usuario que mmradar NO pone el color como style inline
 * (color: rgb(...), que es lo que este parser asumia originalmente,
 * copiando el mismo patron de parseCurrentRank/parsePerformanceRank) --
 * en cambio, cada <p> trae una SEGUNDA clase CSS fija (ej.
 * class="player-title title-blue", class="player-title title-green")
 * que mmradar define en su propio summoner.css externo (confirmado con
 * captura de DevTools del usuario: .title-green tiene color #2ebb7e).
 * Como ese CSS externo no es algo que este proyecto pueda leer via
 * fetch() del HTML solo, se hardcodea el mapa de las clases conocidas
 * (TITLE_CLASS_COLORS abajo) a su hex real tal como aparecen en
 * summoner.css. Si aparece una clase nueva no mapeada, o si mmradar
 * alguna vez vuelve a poner un style inline con rgb() (se deja ese
 * intento como fallback, no hace dano tenerlo), color queda null -- ahi
 * es donde entra el fallback por hash de texto en
 * apps/web/src/lib/mmradarTitleColor.ts, que nunca reemplaza un color
 * real si vino de aca.
 */
const TITLE_CLASS_COLORS: Record<string, string> = {
  "title-blue": "#4fc3e8",
  "title-green": "#2ebb7e",
  "title-purple": "#a855f7",
  "title-yellow": "#eab308",
  "title-red": "#ef4444",
  "title-gold": "#c8aa6e"
};

function colorFromTitleClasses(classAttr: string): string | null {
  for (const [cls, hex] of Object.entries(TITLE_CLASS_COLORS)) {
    if (classAttr.includes(cls)) return hex;
  }
  return null;
}

function parseTitles(html: string): MmradarTitle[] {
  // Se busca directo por el tag de apertura completo de cada
  // <p class="player-title ..."> en TODO el html (no acotado a la
  // ventana entre player-titles> y el primer </div> que le siga, como
  // arrancaba este parser antes -- ese recorte era fragil: si mmradar
  // anida cualquier otro </div> antes del cierre real del contenedor
  // -ej. un div envolviendo un icono de tooltip-, el recorte se cortaba
  // ahi y perdia el resto de los titulos, o los perdia todos si el
  // primer </div> aparecia antes de tiempo). El id player-titles es
  // unico en la pagina, asi que capturar cada <p class="player-title...
  // en cualquier parte del documento es igual de seguro y mas tolerante
  // a cambios de estructura interna del contenedor.
  const titleTagPattern = /<p class="player-title([^"]*)"([^>]*)>([^<]+)</g;
  const titles: MmradarTitle[] = [];

  for (const match of html.matchAll(titleTagPattern)) {
    const classAttr = match[1];
    const attrs = match[2];
    const text = match[3].trim();
    if (!text) continue;

    const colorMatch = attrs.match(/color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    const color = colorMatch
      ? `#${[colorMatch[1], colorMatch[2], colorMatch[3]]
          .map((n) => Number(n).toString(16).padStart(2, "0"))
          .join("")}`
      : colorFromTitleClasses(classAttr);

    titles.push({ text, color });
  }

  return titles;
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
 * El nivel de invocador vive en <p id="summoner-level">574</p>, numero
 * suelto al lado del icono (ver captura de referencia del usuario:
 * "574" superpuesto sobre el icono circular). No se usaba en absoluto
 * hasta ahora -- documentado en el comentario de cabecera del archivo
 * pero nunca parseado. Pedido explicito del usuario 2026-08-19: mostrar
 * el nivel junto al icono en MmradarPanel/PerformancePreviewCard, igual
 * que la referencia de mmradar.gg. null si no se encuentra.
 */
function parseSummonerLevel(html: string): number | null {
  const match = html.match(/id="summoner-level"[^>]*>(\d+)</i);
  return match ? Number(match[1]) : null;
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
    // performanceRank: mmradar calcula el suyo 100% con JS del lado del
    // cliente (confirmado por el usuario con el HTML crudo real -- el tier
    // nunca aparece en lo que fetch() puede leer, ver parsePerformanceRank
    // mas arriba) y ademas no es una funcion simple/observable del
    // promedio (dos perfiles con promedios casi identicos -- 1860 vs
    // ~1894 -- dieron tiers muy distintos: Emerald IV vs Challenger). Por
    // decision del usuario 2026-08-20, la fuente principal ahora es el
    // Performance Rank PROPIO de este proyecto (computePerformanceRank en
    // performanceRank.ts: promedio + winrate + consistencia sobre las
    // mismas partidas de /load-matches), calculado mas abajo despues de
    // fetchRawMatches. parsePerformanceRank(html) se deja como intento
    // sobre el HTML servidor primero, por si mmradar alguna vez vuelve a
    // exponerlo ahi (en la practica actual casi siempre null) -- pero ya
    // no es la fuente que se guarda ni se muestra; solo se pasa como dato
    // informativo extra a titleEngine.ts (regla "underdog", que compara
    // performance vs rango oficial) si llegara a aparecer.
    // performanceScores/titulos: el HTML nunca trae los 6 scores (ver
    // parsePerformanceScores) y mmradar calcula sus propios titulos 100%
    // en el cliente sin exponer un campo explicito en el JSON (ver
    // decision del usuario 2026-08-20 en titleEngine.ts) -- ambos se
    // derivan aca del mismo fetch a /load-matches (fetchRawMatches),
    // fuente distinta del HTML, nunca lanza, un fallo ahi no aborta el
    // resto de este resultado (currentRank/icono/nivel siguen andando).
    const [gameName, tagLine] = lolUsername.split("#");
    const currentRank = parseCurrentRank(html);
    const htmlPerformanceRank = parsePerformanceRank(html);
    const raw = await fetchRawMatches(gameName, tagLine);

    const ownPerformanceRank = raw ? computePerformanceRank(raw.engineMatches) : null;
    const performanceRank = ownPerformanceRank?.rank ?? htmlPerformanceRank;

    const titles = raw
      ? evaluateTitles(
          buildTitleEngineInput(raw.engineMatches, {
            performanceRank,
            currentRank: currentRank?.rank ?? null
          })
        )
      : [];

    return {
      currentRank,
      performanceRank,
      performanceScores: raw?.averageScores ?? null,
      titles,
      iconUrl: parseIconUrl(html),
      server: parseServer(html),
      level: parseSummonerLevel(html)
    };
  } catch (err) {
    if (err instanceof MmradarLookupError) throw err;
    throw new MmradarLookupError(
      "unexpected_format",
      `mmradar.gg cambio su formato: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
