/**
 * Tracking de "ya vi la presentacion secuencial" para el sorteo (1v1) y los
 * combates por equipo -- pedido del usuario 2026-08-21: la primera vez que
 * alguien entra (por landing o directo a /sorteo o /combates) despues de
 * que el sorteo/los combates ya se generaron, se le muestra una revelacion
 * secuencial en vez de la grilla plana de siempre. Las visitas siguientes
 * ya no interrumpen -- se comporta "normal" (grilla + preview en landing).
 *
 * Estado en localStorage, por browser, nunca en Supabase: es puramente
 * "que ya vio este visitante en este dispositivo", no algo que el host
 * necesite auditar ni sincronizar entre dispositivos.
 *
 * Clave del reseteo: en vez de un contador o timestamp de "generacion"
 * separado (que requeriria tocar el schema de event_state y todo el flujo
 * de borrado/regenerado en MatchManager/TeamMatchManager), se guarda el
 * SET de ids ya vistos. Si el sorteo se rehace (se borran combates viejos
 * y se generan nuevos con ids distintos, ver conversacion con el usuario
 * sobre "borrar y volver a girar"), los ids nuevos no estan en el set
 * guardado -> se detecta como no visto automaticamente, sin necesitar
 * ninguna senal explicita de "esto es una regeneracion". Ids repetidos
 * (mismo combate, misma visita) simplemente ya estan en el set y no
 * disparan nada.
 */

const RAFFLE_SEEN_KEY = "velada_raffle_seen_ids";
const TEAM_MATCHES_SEEN_KEY = "velada_team_matches_seen_ids";

function readSeenIds(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeSeenIds(key: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // localStorage lleno/deshabilitado -- la presentacion simplemente
    // volveria a mostrarse la proxima visita, no es un error fatal.
  }
}

/**
 * true si CUALQUIERA de los ids dados todavia no fue marcado como visto
 * para esa clave. Con currentIds vacio siempre da false (nada que revelar).
 */
function hasUnseen(key: string, currentIds: string[]): boolean {
  if (currentIds.length === 0) return false;
  const seen = readSeenIds(key);
  return currentIds.some((id) => !seen.has(id));
}

/** Marca todos los ids dados como vistos (union con lo que ya habia). */
function markSeen(key: string, currentIds: string[]): void {
  const seen = readSeenIds(key);
  for (const id of currentIds) seen.add(id);
  writeSeenIds(key, seen);
}

export function hasUnseenRaffleResults(matchIds: string[]): boolean {
  return hasUnseen(RAFFLE_SEEN_KEY, matchIds);
}

export function markRaffleResultsSeen(matchIds: string[]): void {
  markSeen(RAFFLE_SEEN_KEY, matchIds);
}

export function hasUnseenTeamMatches(teamMatchIds: string[]): boolean {
  return hasUnseen(TEAM_MATCHES_SEEN_KEY, teamMatchIds);
}

export function markTeamMatchesSeen(teamMatchIds: string[]): void {
  markSeen(TEAM_MATCHES_SEEN_KEY, teamMatchIds);
}
