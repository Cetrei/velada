import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseParticipants, type Participant } from "@velada/core";

const PARTICIPANTS_PATH = fileURLToPath(
  new URL("../content/participants.yml", import.meta.url)
);

/**
 * Reads and validates participants.yml at build time (Astro SSG).
 * Falls back to mock data via @velada/core when the file is empty.
 */
export function loadParticipants(): Participant[] {
  const yamlContent = readFileSync(PARTICIPANTS_PATH, "utf-8");
  return parseParticipants(yamlContent);
}
