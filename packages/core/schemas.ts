import { z } from "zod";

export const ParticipantStatsSchema = z.object({
  strength: z.number().min(0).max(100),
  speed: z.number().min(0).max(100),
  stamina: z.number().min(0).max(100),
  toxicLevel: z.number().min(0).max(100)
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
  lolRank: z.string(),
  lolUsername: z.string().optional(),
  lolServer: z.string().optional(),
  mainRole: z.enum(["Top", "Jungle", "Mid", "ADC", "Support"]),
  favChampion: z.string(),
  description: z.string().optional(),
  stats: ParticipantStatsSchema.optional()
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
  currentPhase: EventPhaseSchema.default("COUNTDOWN")
});

export const MatchSchema = z.object({
  id: z.string().uuid().optional(),
  player1Id: z.string(),
  player2Id: z.string(),
  winnerId: z.string().nullable().optional(),
  scheduledAt: z.string().datetime().optional(),
  isRandom: z.boolean().default(false),
  createdAt: z.string().datetime().optional()
});

export const SpinStartPayloadSchema = z.object({
  matchId: z.string().optional(),
  player1Id: z.string(),
  player2Id: z.string(),
  timestamp: z.number()
});

export type Participant = z.infer<typeof ParticipantSchema>;
export type ParticipantStats = z.infer<typeof ParticipantStatsSchema>;
export type EventPhase = z.infer<typeof EventPhaseSchema>;
export type EventState = z.infer<typeof EventStateSchema>;
export type Match = z.infer<typeof MatchSchema>;
export type SpinStartPayload = z.infer<typeof SpinStartPayloadSchema>;
