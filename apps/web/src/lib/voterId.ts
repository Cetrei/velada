const VOTER_ID_KEY = "velada_voter_id";

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `voter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Anonymous per-browser voter id for predictions. Intentionally not tied to
 * auth or any real identity: stored in localStorage only, so clearing
 * storage or using another browser/device lets someone vote again. That is
 * expected behavior for this feature, not a bug — predictions are informal
 * community polls with no verification.
 */
export function getVoterId(): string {
  if (typeof window === "undefined") return "";

  const existing = window.localStorage.getItem(VOTER_ID_KEY);
  if (existing) return existing;

  const id = generateId();
  window.localStorage.setItem(VOTER_ID_KEY, id);
  return id;
}

function votedKey(matchId: string): string {
  return `velada_voted_${matchId}`;
}

export function getLocalVote(matchId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(votedKey(matchId));
}

export function setLocalVote(matchId: string, predictedWinnerId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(votedKey(matchId), predictedWinnerId);
}

const LIKED_FIGHTERS_KEY = "velada_liked_fighters";

/**
 * Local mirror of which participant ids this browser has liked, separate
 * from the single-winner vote keys above: a like is not exclusive (you can
 * like as many fighters as you want), so it's a set of ids rather than one
 * value per match. Kept in sync with fighter_likes in Supabase purely so
 * the UI can show the filled/unfilled heart state without an extra fetch
 * per participant on every render.
 */
function getLikedFighterIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  const raw = window.localStorage.getItem(LIKED_FIGHTERS_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

export function isLocallyLiked(participantId: string): boolean {
  return getLikedFighterIds().has(participantId);
}

export function setLocalLike(participantId: string, liked: boolean): void {
  if (typeof window === "undefined") return;
  const ids = getLikedFighterIds();
  if (liked) {
    ids.add(participantId);
  } else {
    ids.delete(participantId);
  }
  window.localStorage.setItem(LIKED_FIGHTERS_KEY, JSON.stringify([...ids]));
}
