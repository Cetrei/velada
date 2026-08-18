import { parse } from "yaml";
import { ParticipantListSchema, type Participant } from "./schemas";

const MOCK_PARTICIPANTS: Participant[] = [
  {
    id: "mock-1",
    name: "Carlos Fallback",
    nickname: "El Toro de la Toplane",
    lolRank: "Diamond II",
    mainRole: "Top",
    favChampion: "Darius",
    description: "Participante de ejemplo, reemplaza el YAML con datos reales.",
    stats: { strength: 85, speed: 70, stamina: 90, toxicLevel: 60 }
  },
  {
    id: "mock-2",
    name: "Mateo Fallback",
    nickname: "Koreano del Sur",
    lolRank: "Challenger",
    mainRole: "Mid",
    favChampion: "Zed",
    description: "Participante de ejemplo, reemplaza el YAML con datos reales.",
    stats: { strength: 65, speed: 95, stamina: 75, toxicLevel: 40 }
  },
  {
    id: "mock-3",
    name: "David Fallback",
    nickname: "Rey del Smite",
    lolRank: "Master",
    mainRole: "Jungle",
    favChampion: "Lee Sin",
    description: "Participante de ejemplo, reemplaza el YAML con datos reales.",
    stats: { strength: 80, speed: 85, stamina: 80, toxicLevel: 55 }
  },
  {
    id: "mock-4",
    name: "Sofia Fallback",
    nickname: "La Reina",
    lolRank: "Grandmaster",
    mainRole: "ADC",
    favChampion: "Jinx",
    description: "Participante de ejemplo, reemplaza el YAML con datos reales.",
    stats: { strength: 60, speed: 90, stamina: 65, toxicLevel: 35 }
  }
];

/**
 * Parses and validates the participants YAML content.
 * Falls back to mock data when the source is empty so pages never render blank
 * before real rosters are added.
 */
export function parseParticipants(yamlContent: string): Participant[] {
  const raw = parse(yamlContent);

  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return MOCK_PARTICIPANTS;
  }

  const result = ParticipantListSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(
      `Invalid participants.yml: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }

  return result.data;
}

export function isMockParticipant(participant: Participant): boolean {
  return participant.id.startsWith("mock-");
}
