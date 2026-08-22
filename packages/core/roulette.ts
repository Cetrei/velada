/**
 * =============================================================================
 * Sorteo 1v1 sin repeticion -- pedido explicito del usuario 2026-08-21: la
 * ruleta debe ir cubriendo a TODOS los participantes en 1v1 distintos antes
 * de repetir a nadie, y solo repetir cuando el numero de "frescos" que
 * quedan sin pareja es impar (ese ultimo sobrante SI puede salir contra
 * alguien ya usado, no hay forma de evitarlo con numeros impares). Cuando
 * ya salieron todos, arranca una ronda nueva (todos vuelven a estar
 * disponibles) en vez de trabar el sorteo.
 *
 * ANTES: tanto AdminControl.triggerRandomMatch como
 * RouletteWheel.triggerLocalSpin hacian
 * `[...participants].sort(() => Math.random() - 0.5)` y tomaban los
 * primeros dos -- sin memoria de quien ya salio, podia repetir al mismo
 * par (o a la misma persona muchas veces seguidas) mientras otros no
 * salian nunca.
 *
 * Logica pura y testeable, sin tocar Supabase/React -- consume la lista de
 * matches ya sorteados (isRandom: true) mas el pool de participantes, y
 * devuelve el proximo par. El shuffle real (con que aleatoriedad se elige
 * DENTRO del pool elegible) sigue quedando del lado del caller via la
 * funcion `random` inyectada (default Math.random) -- ver nota sobre
 * aleatoriedad mas abajo.
 * =============================================================================
 */

import { computeDuelWinProbability } from "./duelRating";

export interface RouletteMatchLike {
  player1Id: string;
  player2Id: string;
  isRandom?: boolean;
}

export interface RoulettePair {
  player1Id: string;
  player2Id: string;
}

/**
 * Rating de un participante para el modo "equilibrado" del sorteo (ver
 * pickBalancedPair mas abajo) -- mismo shape que DuelInput en
 * duelRating.ts (duelRating con fallback a lolRank), pasado por el caller
 * ya resuelto por participante para no acoplar este archivo a la forma
 * completa de Participant.
 */
export interface RouletteRatingInput {
  duelRating?: number | null;
  lolRank?: string | null;
}

/**
 * Cuenta cuantas veces salio cada participante en combates SORTEADOS
 * (isRandom: true -- los cargados a mano en MatchManager no cuentan para
 * esta cobertura, son otra cosa). Devuelve un Map id -> cantidad de veces.
 */
export function countRandomAppearances(matches: RouletteMatchLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (!m.isRandom) continue;
    counts.set(m.player1Id, (counts.get(m.player1Id) ?? 0) + 1);
    counts.set(m.player2Id, (counts.get(m.player2Id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Fisher-Yates in-place sobre una copia -- reemplaza el
 * `sort(() => Math.random() - 0.5)` que tenian AdminControl/RouletteWheel,
 * que ademas de no llevar memoria de repeticion tampoco es un shuffle
 * uniforme real (sesga el orden, problema conocido de ese patron). `random`
 * se inyecta (default Math.random) solo para poder testear con una
 * implementacion determinista -- Math.random en si no necesita (ni permite
 * desde JS) un seed manual: V8 ya lo auto-siembra con entropia real del
 * sistema en cada arranque del proceso, sembrarlo "a mano" con algo como
 * Date.now() lo haria MENOS aleatorio (predecible/reproducible entre
 * llamadas cercanas), no mas. Lo que si hay que garantizar es que el pool
 * de candidatos se recalcule con los matches mas frescos disponibles justo
 * antes de girar (ver `pickNextPair`) y no con un snapshot viejo -- ese era
 * el riesgo real, no la fuente de aleatoriedad en si.
 */
function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface PickNextPairOptions {
  /** Fuente de aleatoriedad para el shuffle interno. Default Math.random. */
  random?: () => number;
}

/**
 * Devuelve el proximo par a sortear, dado el pool completo de
 * participantes elegibles (ya filtrado de excludeFromMatches por el
 * caller) y los matches ya generados por sorteos anteriores.
 *
 * Reglas (pedido del usuario):
 * 1. Se prioriza emparejar entre participantes que TODAVIA no salieron en
 *    ningun combate sorteado ("frescos").
 * 2. Si hay 2+ frescos, se eligen 2 al azar entre ellos -- nunca toca a
 *    alguien ya usado mientras haya opciones sin usar.
 * 3. Si queda exactamente 1 fresco sin pareja (numero impar de frescos),
 *    ese SI se empareja contra alguien ya usado (elegido al azar entre los
 *    ya usados) -- la unica repeticion permitida, y es forzosa: no hay
 *    forma de dar a todos un 1v1 nuevo con un sobrante de 1.
 * 4. Si ya no queda NINGUN fresco (todos ya salieron al menos una vez), se
 *    considera la cobertura completa y arranca una ronda nueva: todo el
 *    pool vuelve a tratarse como fresco entre si (mismas reglas 1-3 sobre
 *    el pool completo).
 * 5. Nunca empareja a alguien consigo mismo. Con menos de 2 participantes
 *    en el pool total, devuelve null (no hay sorteo posible).
 */
export function pickNextPair(
  allParticipantIds: string[],
  existingMatches: RouletteMatchLike[],
  options: PickNextPairOptions = {}
): RoulettePair | null {
  const uniqueIds = [...new Set(allParticipantIds)];
  if (uniqueIds.length < 2) return null;

  const random = options.random ?? Math.random;
  const appearances = countRandomAppearances(existingMatches);

  let fresh = uniqueIds.filter((id) => !appearances.has(id));
  // Regla 4: cobertura completa -- todos ya salieron al menos una vez,
  // arranca ronda nueva tratando a todo el pool como fresco de nuevo.
  if (fresh.length === 0) fresh = [...uniqueIds];

  if (fresh.length >= 2) {
    const [player1Id, player2Id] = shuffle(fresh, random);
    return { player1Id, player2Id };
  }

  // Regla 3: exactamente 1 fresco sobrante -- lo empareja contra alguien
  // ya usado (cualquiera del resto del pool que no sea el mismo).
  const soleFreshId = fresh[0];
  const usedPool = uniqueIds.filter((id) => id !== soleFreshId);
  if (usedPool.length === 0) return null; // pool de 1 participante total, no hay con quien
  const opponentId = shuffle(usedPool, random)[0];

  return { player1Id: soleFreshId, player2Id: opponentId };
}

/**
 * Que tan lejos del 50/50 esta un par -- 0 es el combate mas renido
 * posible (ambos con la misma probabilidad de ganar), 48 el mas parejo
 * posible dentro del clamp de computeDuelWinProbability (2/98).
 */
function closenessScore(
  aId: string,
  bId: string,
  ratingsById: Map<string, RouletteRatingInput>
): number {
  const a = ratingsById.get(aId) ?? {};
  const b = ratingsById.get(bId) ?? {};
  const { playerAWinPct } = computeDuelWinProbability(a, b);
  return Math.abs(playerAWinPct - 50);
}

/**
 * Entre pares con un closenessScore casi identico (diferencia menor a
 * este umbral en puntos porcentuales), se desempata al azar en vez de
 * quedarse siempre con el primero encontrado -- evita que el modo
 * equilibrado sea 100% determinista cuando hay varios pares igual de
 * parejos disponibles (ej. todo el pool con el mismo duelRating).
 */
const CLOSENESS_TIE_TOLERANCE = 1;

/**
 * Arma TODOS los pares posibles dentro de `ids` y devuelve el mas renido
 * segun closenessScore -- entre empates (dentro de CLOSENESS_TIE_TOLERANCE
 * puntos del mejor encontrado), elige al azar. O(n^2) sobre el pool de
 * frescos, trivial en tamaño para cualquier cantidad realista de
 * participantes de una velada.
 */
function closestPairAmong(
  ids: string[],
  ratingsById: Map<string, RouletteRatingInput>,
  random: () => number
): RoulettePair {
  const candidates: { pair: RoulettePair; score: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const score = closenessScore(ids[i], ids[j], ratingsById);
      candidates.push({ pair: { player1Id: ids[i], player2Id: ids[j] }, score });
    }
  }

  const bestScore = Math.min(...candidates.map((c) => c.score));
  const bestCandidates = candidates.filter((c) => c.score <= bestScore + CLOSENESS_TIE_TOLERANCE);
  const chosen = bestCandidates[Math.floor(random() * bestCandidates.length)];
  return chosen.pair;
}

/**
 * Mismas reglas de cobertura que pickNextPair (frescos primero, 1 sobrante
 * fuerza repeticion, cobertura completa reinicia la ronda -- ver el
 * comentario grande de pickNextPair mas arriba, no se repite aca) pero en
 * vez de elegir al azar DENTRO del pool elegible, elige el par MAS RENIDO
 * segun computeDuelWinProbability (duelRating con fallback a lolRank, ver
 * duelRating.ts) -- pedido del usuario 2026-08-21: "agrega al generador de
 * 1 vs 1 que ademas de balanceado poder generar por equilibrio (combates
 * renidos)". A diferencia del balanceador de EQUIPOS
 * (teamBalancer.ts/TeamGenerationMode), ese es el unico modo que se pide
 * para el 1v1 -- no hay equivalente a "unfair" aca ("el de desventaja no
 * hace falta").
 *
 * `ratings` debe traer un entry por cada id en `allParticipantIds` -- a
 * quien le falte se le calcula igual (computeDuelWinProbability ya cae a
 * 50 neutral sin duelRating ni lolRank), pero puede terminar emparejado de
 * forma menos precisa al no tener ninguna señal real.
 */
export function pickBalancedPair(
  allParticipantIds: string[],
  existingMatches: RouletteMatchLike[],
  ratings: Map<string, RouletteRatingInput>,
  options: PickNextPairOptions = {}
): RoulettePair | null {
  const uniqueIds = [...new Set(allParticipantIds)];
  if (uniqueIds.length < 2) return null;

  const random = options.random ?? Math.random;
  const appearances = countRandomAppearances(existingMatches);

  let fresh = uniqueIds.filter((id) => !appearances.has(id));
  if (fresh.length === 0) fresh = [...uniqueIds];

  if (fresh.length >= 2) {
    return closestPairAmong(fresh, ratings, random);
  }

  // Exactamente 1 fresco sobrante: en vez de un rival al azar entre los ya
  // usados (como pickNextPair), elige el rival ya-usado que le de el
  // combate mas parejo -- sigue siendo la unica repeticion forzosa
  // (regla 3), pero eligiendo CUAL repeticion segun cercania de nivel.
  const soleFreshId = fresh[0];
  const usedPool = uniqueIds.filter((id) => id !== soleFreshId);
  if (usedPool.length === 0) return null;

  // soleFreshId SIEMPRE tiene que quedar en el par (es el unico sin
  // cobertura todavia) -- se busca entre los pares que lo incluyen a el
  // contra cada rival ya-usado, el mas renido segun closenessScore.
  const pairsWithFresh = usedPool.map((opponentId) => ({
    opponentId,
    score: closenessScore(soleFreshId, opponentId, ratings)
  }));
  const bestScore = Math.min(...pairsWithFresh.map((p) => p.score));
  const bestCandidates = pairsWithFresh.filter((p) => p.score <= bestScore + CLOSENESS_TIE_TOLERANCE);
  const chosen = bestCandidates[Math.floor(random() * bestCandidates.length)];

  return { player1Id: soleFreshId, player2Id: chosen.opponentId };
}
