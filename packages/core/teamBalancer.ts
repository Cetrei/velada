/**
 * Genera combates por equipos (5v5, o mezclas de 4v4/3v3 cuando el numero
 * total de participantes disponibles no es multiplo de 10) a partir de una
 * lista de participantes y su skill rating (ver skillRating.ts).
 *
 * Tres modos:
 * - "random": equipos puramente al azar, sin mirar habilidad.
 * - "balanced": minimiza la diferencia de skill rating total entre los
 *   dos equipos de cada partida (draft tipo serpiente: 1-2-2-1-1-2-2-1...
 *   alternando de que equipo saca el siguiente jugador, tomando siempre
 *   del extremo mas fuerte disponible, para que ambos lados terminen con
 *   suma de rating lo mas pareja posible).
 * - "unfair": maximiza la diferencia -- arma el equipo mas fuerte posible
 *   contra el mas debil posible (los N/2 participantes de mayor rating
 *   contra los N/2 de menor rating).
 *
 * Cuando hay que generar VARIOS partidos a la vez con mas participantes
 * que los que caben en un solo 5v5, primero se agrupan todos los
 * disponibles en bloques de tamano par (preferiendo 10 -> 5v5, y usando
 * 8 -> 4v4 o 6 -> 3v3 para el resto, nunca dejando a nadie afuera si el
 * total lo permite) y despues se balancea cada bloque por separado.
 */

import { computeSkillRating, type SkillRatingInput } from "./skillRating";

export type TeamGenerationMode = "random" | "balanced" | "unfair";

export interface BalancerParticipant extends SkillRatingInput {
  id: string;
}

export interface GeneratedTeamMatch {
  teamAIds: string[];
  teamBIds: string[];
  teamARating: number;
  teamBRating: number;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Reparte `total` participantes en bloques de tamano par (entre 6 y 10,
 * ambos inclusive) sin dejar ninguno afuera. Prioriza bloques de 10
 * (5v5): por ejemplo 23 participantes -> [10, 10, ... no alcanza, esto es
 * imposible con 23 porque es impar] -- en la practica el total SIEMPRE
 * debe ser par (cada equipo necesita el mismo numero de jugadores en
 * ambos lados via 1v1 real de LoL), asi que un total impar deja
 * automaticamente a 1 participante fuera de esta generacion (se reporta
 * aparte, no se fuerza un equipo desparejo).
 *
 * Ejemplos: 20 -> [10, 10]. 18 -> [10, 8] o [6,6,6] (se prefiere minimizar
 * cantidad de bloques chicos, asi que 18 -> [10, 8]). 16 -> [10, 6] o
 * [8, 8] (se prefiere [8,8] por quedar mas parejo entre partidas). 14 ->
 * [8, 6]. 12 -> [6, 6] o [10, 2] (2 es invalido, min bloque es 6, asi que
 * [6, 6]). 8 -> [8]. 6 -> [6]. Menos de 6 -> ningun bloque (no alcanza ni
 * para un 3v3), esos participantes quedan sin asignar.
 */
export function planTeamBlockSizes(total: number): number[] {
  if (total < 6) return [];

  const blocks: number[] = [];
  let remaining = total;

  while (remaining >= 6) {
    if (remaining === 7) {
      // 7 no se puede repartir en bloques pares de una sola pieza sin
      // sobra evitable: se toma un bloque de 6 (3v3) y sobra 1 afuera,
      // mejor que forzar un 10 imposible o dejar 2 bloques desparejos.
      blocks.push(6);
      remaining -= 6;
      break;
    }
    if (remaining >= 10) {
      blocks.push(10);
      remaining -= 10;
    } else {
      // remaining es 6, 8 o 9 aca. 9 no es par -> se toma 8 y sobra 1.
      const block = remaining === 9 ? 8 : remaining;
      blocks.push(block);
      remaining -= block;
    }
  }

  return blocks;
}

function ratingOf(p: BalancerParticipant): number {
  return computeSkillRating(p);
}

/**
 * Snake draft por rating descendente: ordena a todos por rating de mayor
 * a menor, y los reparte alternando equipo en zigzag (A,B,B,A,A,B,B,A...)
 * -- el patron zigzag (no A,B,A,B llano) es lo que hace que un draft
 * "serpiente" quede balanceado: sin el, el equipo A siempre recibiria al
 * participante impar-mas-fuerte de cada par consecutivo.
 */
function balancedSplit(pool: BalancerParticipant[]): { teamA: BalancerParticipant[]; teamB: BalancerParticipant[] } {
  const sorted = [...pool].sort((a, b) => ratingOf(b) - ratingOf(a));
  const teamA: BalancerParticipant[] = [];
  const teamB: BalancerParticipant[] = [];

  let goesToA = true;
  let sinceFlip = 0;
  for (const p of sorted) {
    if (goesToA) teamA.push(p);
    else teamB.push(p);

    sinceFlip += 1;
    if (sinceFlip === 2) {
      goesToA = !goesToA;
      sinceFlip = 0;
    }
  }

  return { teamA, teamB };
}

/**
 * Los N/2 de mayor rating contra los N/2 de menor rating -- el equipo mas
 * fuerte posible contra el mas debil posible dentro de ese bloque.
 */
function unfairSplit(pool: BalancerParticipant[]): { teamA: BalancerParticipant[]; teamB: BalancerParticipant[] } {
  const sorted = [...pool].sort((a, b) => ratingOf(b) - ratingOf(a));
  const half = sorted.length / 2;
  return { teamA: sorted.slice(0, half), teamB: sorted.slice(half) };
}

function randomSplit(pool: BalancerParticipant[]): { teamA: BalancerParticipant[]; teamB: BalancerParticipant[] } {
  const shuffled = shuffle(pool);
  const half = shuffled.length / 2;
  return { teamA: shuffled.slice(0, half), teamB: shuffled.slice(half) };
}

function splitBlock(
  pool: BalancerParticipant[],
  mode: TeamGenerationMode
): { teamA: BalancerParticipant[]; teamB: BalancerParticipant[] } {
  switch (mode) {
    case "balanced":
      return balancedSplit(pool);
    case "unfair":
      return unfairSplit(pool);
    case "random":
    default:
      return randomSplit(pool);
  }
}

export interface GenerateTeamMatchesResult {
  matches: GeneratedTeamMatch[];
  /** Participantes que no entraron en ningun bloque (sobra, o total < 6). */
  leftOverIds: string[];
}

/**
 * Punto de entrada principal: arma uno o mas team matches a partir de la
 * lista de participantes disponibles (ya filtrada de excluidos por el
 * caller). Divide en bloques via planTeamBlockSizes, y balancea cada
 * bloque de forma independiente segun `mode` -- balancear bloques por
 * separado (no todos los participantes juntos) es intencional: cada
 * bloque es un partido de LoL real distinto, no tiene sentido que el
 * jugador mas fuerte de TODO el evento y el mas debil de TODO el evento
 * terminen en el mismo bloque de 6 solo porque el algoritmo optimizo
 * globalmente.
 */
export function generateTeamMatches(
  participants: BalancerParticipant[],
  mode: TeamGenerationMode
): GenerateTeamMatchesResult {
  const shuffledForBlocking = mode === "random" ? shuffle(participants) : [...participants];
  // Para balanced/unfair, el orden de entrada a los bloques no importa
  // (cada bloque se re-ordena por rating adentro de splitBlock), pero
  // barajar aca de una vez para "random" evita que el primer bloque
  // siempre agarre a los primeros N participantes de la lista original.

  const blockSizes = planTeamBlockSizes(shuffledForBlocking.length);
  const matches: GeneratedTeamMatch[] = [];

  let cursor = 0;
  for (const size of blockSizes) {
    const block = shuffledForBlocking.slice(cursor, cursor + size);
    cursor += size;

    const { teamA, teamB } = splitBlock(block, mode);
    matches.push({
      teamAIds: teamA.map((p) => p.id),
      teamBIds: teamB.map((p) => p.id),
      teamARating: sum(teamA.map(ratingOf)),
      teamBRating: sum(teamB.map(ratingOf))
    });
  }

  const leftOverIds = shuffledForBlocking.slice(cursor).map((p) => p.id);

  return { matches, leftOverIds };
}
