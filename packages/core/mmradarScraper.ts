import type { TitleEngineMatch } from "./titleEngine";
import { buildTitleEngineInput, evaluateTitles } from "./titleEngine";
import { computePerformanceRank } from "./performanceRank";
import { computeDuelRatingFromMatches, type DuelRatingResult } from "./duelRating";
import type { MmradarTitle } from "./schemas";

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
  titles: MmradarTitle[];
  /** URL del icono de invocador (id="summoner-icon"). null si no se encontro -- no es un error, el componente que lo consume simplemente no lo muestra. */
  iconUrl: string | null;
  /** Servidor/region tal como lo muestra mmradar junto al nombre (id="region", ej. "LAN"). null si no se encontro. */
  server: string | null;
  /** Nivel de invocador (id="summoner-level", numero suelto al lado del icono). null si no se encontro. */
  level: number | null;
  /** Habilidad 1v1 propia (ver duelRating.ts). null si no hubo partidas suficientes para calcularla. */
  duelRating: DuelRatingResult | null;
  /**
   * Partidas ya reducidas al shape de TitleEngineMatch, tal como se le
   * pasaron a computePerformanceRank/evaluateTitles/computeDuelRatingFromMatches
   * internamente. Se expone solo para diagnostico/calibracion (ver
   * scripts/test-rank-calibration.test.ts) -- el pipeline real de la app no
   * la necesita, ya recibe los resultados ya calculados arriba. null si no
   * hubo partidas recientes disponibles.
   */
  engineMatches: TitleEngineMatch[] | null;
}

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

  // Fallback
  const beforeWindow = html.slice(Math.max(0, idx - 400), idx);
  const altPattern = new RegExp(`(?:alt|data-tooltip)="(${TIER_WORDS.join("|")})[^"]*"`, "i");
  const altMatch = beforeWindow.match(altPattern);
  if (altMatch) {
    return altMatch[1].charAt(0).toUpperCase() + altMatch[1].slice(1).toLowerCase();
  }

  return null;
}

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

interface RawMatchesResult {
  averageScores: MmradarPerformanceScores;
  /** Partidas ya reducidas al shape que necesita titleEngine.ts (ver TitleEngineMatch). */
  engineMatches: TitleEngineMatch[];
}

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

      const computedPlayerTotal =
        player.scores.laning +
        player.scores.farming +
        player.scores.objectives +
        player.scores.combat +
        player.scores.teamfight +
        player.scores.vision;

      const highestTotal = Math.max(
        ...match.participants.map((p) => {
          if (!p.scores) return -Infinity;
          return (
            p.scores.laning +
            p.scores.farming +
            p.scores.objectives +
            p.scores.combat +
            p.scores.teamfight +
            p.scores.vision
          );
        })
      );

      engineMatches.push({
        championName: player.championName ?? "?",
        scores: {
          laning: player.scores.laning,
          farming: player.scores.farming,
          objectives: player.scores.objectives,
          combat: player.scores.combat,
          teamfight: player.scores.teamfight,
          vision: player.scores.vision,
          total: computedPlayerTotal
        },
        won: typeof match.winningTeam === "number" && player.teamId === match.winningTeam,
        wasTopScoreInMatch: computedPlayerTotal >= highestTotal
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

    titles.push({ text, color, reason: null });
  }

  return titles;
}

function parseIconUrl(html: string): string | null {
  const match = html.match(/id="summoner-icon"[^>]*src="([^"]+)"/i);
  return match ? match[1] : null;
}

function parseSummonerLevel(html: string): number | null {
  const match = html.match(/id="summoner-level"[^>]*>(\d+)</i);
  return match ? Number(match[1]) : null;
}

function parseServer(html: string): string | null {
  const match = html.match(/id="region"[^>]*>([^<]+)</i);
  return match ? match[1].trim() : null;
}

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

    const duelRating = raw
      ? computeDuelRatingFromMatches(raw.engineMatches, {
          performanceRank,
          currentRank: currentRank?.rank ?? null
        })
      : null;

    return {
      currentRank,
      performanceRank,
      performanceScores: raw?.averageScores ?? null,
      titles,
      iconUrl: parseIconUrl(html),
      server: parseServer(html),
      level: parseSummonerLevel(html),
      duelRating,
      engineMatches: raw?.engineMatches ?? null
    };
  } catch (err) {
    if (err instanceof MmradarLookupError) throw err;
    throw new MmradarLookupError(
      "unexpected_format",
      `mmradar.gg cambio su formato: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
