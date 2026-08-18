import { parseParticipants, type Participant } from "@velada/core";

const yamlModules = import.meta.glob("../data/participants.yml", {
  eager: true,
  query: "?raw",
  import: "default"
}) as Record<string, string>;

const PARTICIPANTS_YAML = Object.values(yamlModules)[0] ?? "";

/**
 * Reads and validates participants.yml, bundled at build time via
 * import.meta.glob (not node:fs) so it works on Cloudflare Workers, which
 * has no filesystem access at runtime.
 * Falls back to mock data via @velada/core when the file is empty.
 */
export function loadParticipants(): Participant[] {
  return parseParticipants(PARTICIPANTS_YAML);
}
