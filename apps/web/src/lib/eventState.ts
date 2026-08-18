import { getSupabaseClient } from "./supabase";
import type { EventState } from "@velada/core";

const FALLBACK_EVENT_STATE: EventState = {
  id: "main",
  startTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  rouletteUnlocked: false,
  currentPhase: "COUNTDOWN",
  registrationsOpen: true,
  votingEnabled: false,
  eventStarted: false
};

/**
 * Fetches the live event_state row from Supabase. Falls back to a static
 * 7-days-from-now countdown when Supabase is not configured, so the site
 * still works before `bun run setup:supabase` has been run.
 */
export async function fetchEventState(): Promise<EventState> {
  const supabase = getSupabaseClient();
  if (!supabase) return FALLBACK_EVENT_STATE;

  const { data, error } = await supabase
    .from("event_state")
    .select("id, start_time, roulette_unlocked, current_phase, registrations_open, voting_enabled, event_started")
    .eq("id", "main")
    .maybeSingle();

  if (error || !data) {
    console.warn("Falling back to static event state:", error?.message);
    return FALLBACK_EVENT_STATE;
  }

  return {
    id: data.id,
    startTime: data.start_time,
    rouletteUnlocked: data.roulette_unlocked,
    currentPhase: data.current_phase,
    registrationsOpen: data.registrations_open ?? true,
    votingEnabled: data.voting_enabled ?? false,
    eventStarted: data.event_started ?? false
  };
}
