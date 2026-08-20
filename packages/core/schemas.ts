import { z } from "zod";

export const ParticipantStatSchema = z.object({
  label: z.string().min(1),
  value: z.number().min(0).max(100)
});

/**
 * Maximo de stats custom por peleador. Definido como constante exportada
 * (no un numero hardcodeado repetido en cada formulario) para que el
 * limite del schema (fuente de verdad server-side) y los inputs del
 * cliente (ParticipantProfileForm.tsx, ParticipantManager.tsx) usen
 * exactamente el mismo valor. 4 es el maximo visual razonable segun el
 * render de la carta (PlayerCard.tsx) -- mas de 4 barras no entra bien en
 * el espacio disponible bajo el header.
 */
export const MAX_CUSTOM_STATS = 4;

export const ParticipantStatsSchema = z.array(ParticipantStatSchema).min(0).max(MAX_CUSTOM_STATS);

export const MmradarPerformanceScoresSchema = z.object({
  laning: z.number(),
  farming: z.number(),
  objectives: z.number(),
  combat: z.number(),
  teamfight: z.number(),
  vision: z.number()
});

/**
 * Un titulo de mmradar (ej. "OTP Kindred", "MVP") junto con su color real
 * si el HTML de mmradar.gg lo trae (ver parseTitles en
 * mmradarScraper.ts) -- color queda null cuando la fuente no expone un
 * color para ese titulo puntual, nunca se rellena con un valor inventado
 * aca en el schema.
 */
export const MmradarTitleSchema = z.object({
  text: z.string().min(1),
  color: z.string().nullable(),
  /**
   * Por que se otorgo el titulo, con los numeros reales del jugador (ver
   * TitleDefinition.reason en titleEngine.ts). null solo para titulos de
   * meme (participant.memeTitles) que no pasan por el motor propio.
   */
  reason: z.string().nullable().optional()
});

export const ParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  nickname: z.string(),
  photo: z.string().optional(),
  banner: z.string().optional(),
  age: z.number().int().positive().optional(),
  weight: z.string().optional(),
  height: z.string().optional(),
  country: z.string().optional(),
  countryFlag: z.string().optional(),
  instagramHandle: z.string().optional(),
  instagramFollowers: z.string().optional(),
  xHandle: z.string().optional(),
  xFollowers: z.string().optional(),
  lolRank: z.string(),
  lolUsername: z.string().optional(),
  lolServer: z.string().optional(),
  mainRole: z.enum(["Top", "Jungle", "Mid", "ADC", "Support"]),
  favChampion: z.string(),
  description: z.string().optional(),
  stats: ParticipantStatsSchema.optional(),
  performanceRank: z.string().nullable().optional(),
  performanceScores: MmradarPerformanceScoresSchema.nullable().optional(),
  titles: z.array(MmradarTitleSchema).nullable().optional(),
  mmradarIconUrl: z.string().nullable().optional(),
  mmradarServer: z.string().nullable().optional(),
  mmradarLevel: z.number().nullable().optional(),
  /**
   * Habilidad 1v1 propia (ver packages/core/duelRating.ts): 0-100, con
   * confidence 0-1 segun cuantas partidas hubo detras del calculo.
   * Cacheados igual que el resto de datos de mmradar -- se recalculan al
   * guardar/actualizar el perfil, nunca en cada render.
   */
  duelRating: z.number().nullable().optional(),
  duelConfidence: z.number().nullable().optional(),
  /**
   * Cuando fue la ultima vez que se re-consulto mmradar para este perfil
   * (se pisa junto con el resto de datos de mmradar en
   * saveOwnParticipant/saveParticipant/refreshMmradarData). Se muestra en
   * la ficha publica junto al boton "Actualizar" -- null solo si nunca se
   * consulto mmradar para este perfil (alta sin Riot ID, por ejemplo).
   */
  mmradarUpdatedAt: z.string().datetime().nullable().optional(),
  /**
   * Participante "de meme": aparece en el roster/grid de seleccion como
   * cualquier otro, pero se excluye de todo lo competitivo -- ruleta,
   * combates 1v1, generacion/balanceo de team matches, y tallies de
   * pronosticos. Solo lo pueden traer los participantes meme del YAML
   * (ver apps/web/src/data/meme-participants.yml + loadParticipants.ts);
   * nunca se escribe desde el panel de admin ni desde /inscripcion, asi
   * que no hace falta persistirlo en Supabase.
   */
  excludeFromMatches: z.boolean().optional(),
  /**
   * Campos exclusivos de participantes "de meme" (excludeFromMatches:
   * true), cargados a mano en meme-participants.yml -- nunca vienen de
   * mmradar ni de ningun formulario real. Se muestran SOLO en la ficha
   * publica de ese participante puntual (peleadores/[id].astro), nunca en
   * /combates, /sorteo, el balanceador de equipos, ni en ningun otro
   * listado -- son 100% de broma, no representan combates reales del
   * evento. Un participante real (no-meme) nunca deberia tener estos
   * campos poblados; no hay forma de escribirlos desde /inscripcion ni
   * desde el panel de admin.
   */
  memeTitles: z.array(z.string()).optional(),
  memeIconUrl: z.string().optional(),
  memeFakeMatch: z
    .object({
      opponentName: z.string().min(1),
      opponentNickname: z.string().min(1),
      opponentPhoto: z.string().optional(),
      result: z.enum(["win", "loss"]).optional(),
      decision: z.string().optional()
    })
    .optional(),
  memeFakeTeamMatch: z
    .object({
      teamName: z.string().optional(),
      teammateNames: z.array(z.string()).default([]),
      rivalTeamName: z.string().optional(),
      rivalNames: z.array(z.string()).default([]),
      result: z.enum(["win", "loss"]).optional()
    })
    .optional()
});

export const ParticipantListSchema = z.array(ParticipantSchema);

export const EventPhaseSchema = z.enum([
  "COUNTDOWN",
  "SHOWCASE",
  "ROULETTE",
  "MATCHES",
  "ENDED"
]);

/**
 * Independent on/off switches the host flips from /admin in any order,
 * unlike the old currentPhase enum (mutually exclusive, fixed order). Each
 * flag only gates what's enabled/disabled on the public site:
 * - registrationsOpen: /inscripcion accepts new signups + profile edits
 * - rouletteUnlocked: /sorteo shows the wheel instead of the locked screen
 * - votingEnabled: predictions/pronosticos accept votes (still also needs
 *   the per-match predictionsOpen flag from admin's match editor)
 * - eventStarted: purely informational "la velada ya empezo" flag, shown in
 *   the UI; the countdown itself only marks the planned start time.
 * currentPhase and rouletteUnlocked (top-level) are kept for backwards
 * compatibility with existing rows/components that already read them.
 */
export const EventStateSchema = z.object({
  id: z.string().default("main"),
  startTime: z.string().datetime(),
  rouletteUnlocked: z.boolean().default(false),
  currentPhase: EventPhaseSchema.default("COUNTDOWN"),
  registrationsOpen: z.boolean().default(true),
  votingEnabled: z.boolean().default(false),
  eventStarted: z.boolean().default(false)
});

export const JudgeCardSchema = z.object({
  country: z.string().min(1),
  scorePlayer1: z.number().int(),
  scorePlayer2: z.number().int()
});

export const MatchSchema = z.object({
  id: z.string().uuid().optional(),
  matchNumber: z.number().int().positive().optional(),
  name: z.string().nullable().optional(),
  player1Id: z.string(),
  player2Id: z.string(),
  winnerId: z.string().nullable().optional(),
  decision: z.string().nullable().optional(),
  judgeCards: z.array(JudgeCardSchema).nullable().optional(),
  predictionsOpen: z.boolean().default(false),
  scheduledAt: z.string().datetime().optional(),
  isRandom: z.boolean().default(false),
  createdAt: z.string().datetime().optional()
});

export const PredictionSchema = z.object({
  matchId: z.string().uuid(),
  voterId: z.string().min(1),
  predictedWinnerId: z.string().min(1),
  createdAt: z.string().datetime().optional()
});

export const PredictionTallySchema = z.object({
  matchId: z.string().uuid(),
  player1Votes: z.number().int().nonnegative(),
  player2Votes: z.number().int().nonnegative(),
  totalVotes: z.number().int().nonnegative()
});

export const SpinStartPayloadSchema = z.object({
  matchId: z.string().optional(),
  player1Id: z.string(),
  player2Id: z.string(),
  timestamp: z.number()
});

/**
 * Un combate por equipos (5v5, 4v4 o 3v3 -- cualquier tamano parejo entre
 * ambos lados, no necesariamente 5v5 fijo) del evento mayor. A diferencia
 * de Match (1v1 de la ruleta), aca el resultado es un solo ganador para
 * TODO el equipo, como en una partida real de LoL -- no hay resultado por
 * jugador individual. teamAIds/teamBIds son listas de participant ids;
 * ambas listas deben tener el mismo tamano entre si (se valida en la
 * action, no aca, porque zod no expresa bien "len(a) === len(b)" con un
 * mensaje de error util).
 */
export const TeamMatchSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().nullable().optional(),
  teamAIds: z.array(z.string()).min(1),
  teamBIds: z.array(z.string()).min(1),
  winnerTeam: z.enum(["A", "B"]).nullable().optional(),
  generationMode: z.enum(["manual", "random", "balanced", "unfair"]).default("manual"),
  createdAt: z.string().datetime().optional()
});

export type Participant = z.infer<typeof ParticipantSchema>;
export type ParticipantStat = z.infer<typeof ParticipantStatSchema>;
export type ParticipantStats = z.infer<typeof ParticipantStatsSchema>;
export type EventPhase = z.infer<typeof EventPhaseSchema>;
export type EventState = z.infer<typeof EventStateSchema>;
export type JudgeCard = z.infer<typeof JudgeCardSchema>;
export type Match = z.infer<typeof MatchSchema>;
export type Prediction = z.infer<typeof PredictionSchema>;
export type PredictionTally = z.infer<typeof PredictionTallySchema>;
export type SpinStartPayload = z.infer<typeof SpinStartPayloadSchema>;
export type TeamMatch = z.infer<typeof TeamMatchSchema>;
export type MmradarPerformanceScores = z.infer<typeof MmradarPerformanceScoresSchema>;
export type MmradarTitle = z.infer<typeof MmradarTitleSchema>;
