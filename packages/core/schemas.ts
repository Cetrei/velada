import { z } from "zod";

export const ParticipantStatSchema = z.object({
  label: z.string().min(1),
  value: z.number().min(0).max(100)
});

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

export const MmradarTitleSchema = z.object({
  text: z.string().min(1),
  color: z.string().nullable(),
  reason: z.string().nullable().optional()
});

/**
 * Una partida individual ya reducida al shape que necesita titleEngine.ts
 * (TitleEngineMatch). Duplicado deliberado del type de
 * packages/core/titleEngine.ts en vez de importarlo -- este schema es lo
 * que valida la fila cruda de Supabase (mmradar_engine_matches), y
 * titleEngine.ts no expone su interface como schema Zod. Si el shape de
 * TitleEngineMatch cambia, este tiene que actualizarse a mano en el mismo
 * cambio.
 */
export const EngineMatchSchema = z.object({
  championName: z.string(),
  scores: MmradarPerformanceScoresSchema.extend({ total: z.number() }),
  won: z.boolean(),
  wasTopScoreInMatch: z.boolean()
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

  duelRating: z.number().nullable().optional(),
  duelConfidence: z.number().nullable().optional(),
  mmradarUpdatedAt: z.string().nullable().optional(),
  /**
   * Partidas crudas de mmradar.gg persistidas solo para calibracion offline
   * (ver scripts/test-rank-calibration.test.ts) -- nunca se usa en el
   * render de ninguna pagina ni componente, es intencionalmente pesado
   * (hasta ~20 partidas por jugador) y no se selecciona en el select() de
   * loadParticipants.ts para no inflar el payload de cada carga de pagina.
   */
  mmradarEngineMatches: z.array(EngineMatchSchema).nullable().optional(),
  excludeFromMatches: z.boolean().optional(),
  
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
