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
    stats: [
      { label: "Mental", value: 85 },
      { label: "Toxicidad", value: 60 },
      { label: "Micro", value: 70 },
      { label: "Macro", value: 90 }
    ]
  },
  {
    id: "mock-2",
    name: "Mateo Fallback",
    nickname: "Koreano del Sur",
    lolRank: "Challenger",
    mainRole: "Mid",
    favChampion: "Zed",
    description: "Participante de ejemplo, reemplaza el YAML con datos reales.",
    stats: [
      { label: "Mental", value: 65 },
      { label: "Toxicidad", value: 40 },
      { label: "Micro", value: 95 },
      { label: "Macro", value: 75 }
    ]
  },
  {
    id: "mock-3",
    name: "David Fallback",
    nickname: "Rey del Smite",
    lolRank: "Master",
    mainRole: "Jungle",
    favChampion: "Lee Sin",
    description: "Participante de ejemplo, reemplaza el YAML con datos reales.",
    stats: [
      { label: "Mental", value: 80 },
      { label: "Toxicidad", value: 55 },
      { label: "Micro", value: 85 },
      { label: "Macro", value: 80 }
    ]
  },
  {
    id: "mock-4",
    name: "Sofia Fallback",
    nickname: "La Reina",
    lolRank: "Grandmaster",
    mainRole: "ADC",
    favChampion: "Jinx",
    description: "Participante de ejemplo, reemplaza el YAML con datos reales.",
    stats: [
      { label: "Mental", value: 60 },
      { label: "Toxicidad", value: 35 },
      { label: "Micro", value: 90 },
      { label: "Macro", value: 65 }
    ]
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
