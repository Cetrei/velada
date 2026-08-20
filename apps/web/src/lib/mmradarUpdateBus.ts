/**
 * Bus de eventos minimo en el cliente para que MmradarPanel (columna
 * derecha de /peleadores/[id], reemplaza el bloque de "Su rival") pueda
 * avisarle a PlayerCard (columna izquierda) que hay datos nuevos de
 * performance, sin que ambos tengan que vivir en el mismo arbol de React.
 *
 * Astro monta cada componente con `client:load` como una isla separada
 * -- no comparten estado de React entre si aunque esten en la misma
 * pagina y lean la misma fila de participants. Antes de esto, apretar
 * "Actualizar" en MmradarPanel nunca movia la barra de performance de
 * PlayerCard sin recargar toda la pagina. Un EventTarget a nivel de
 * modulo (singleton, vive mientras dure la pestaña) es la forma mas
 * chica de resolver esto para un solo caso de uso -- no amerita meter
 * una libreria de estado global (zustand/jotai/context-provider-en-el-
 * layout) por un unico par de componentes que se comunican una sola vez
 * por click.
 *
 * Scope: los eventos van filtrados por participantId para que, si en
 * algun momento hay mas de una ficha en pantalla (no pasa hoy), un
 * "Actualizar" de un jugador no le pise el estado a otro.
 */

import type { MmradarPerformanceScores } from "@velada/core";

export interface MmradarUpdatePayload {
  participantId: string;
  performanceRank: string | null;
  /**
   * Ampliado junto con performanceRank: antes solo se propagaba el texto
   * del rango, asi que apretar "Actualizar" en MmradarPanel actualizaba
   * el texto de performance en PlayerCard pero nunca su barra (que recien
   * empezo a existir en esta misma vuelta -- ver PlayerCard.tsx). Ahora
   * viajan los 6 scores crudos tambien, para que PlayerCardLive pueda
   * recalcular el ancho de la barra sin recargar la pagina.
   */
  performanceScores: MmradarPerformanceScores | null;
}

const bus = new EventTarget();
const EVENT_NAME = "mmradar-performance-updated";

export function emitMmradarUpdate(payload: MmradarUpdatePayload): void {
  bus.dispatchEvent(new CustomEvent<MmradarUpdatePayload>(EVENT_NAME, { detail: payload }));
}

export function onMmradarUpdate(listener: (payload: MmradarUpdatePayload) => void): () => void {
  const handler = (e: Event) => {
    listener((e as CustomEvent<MmradarUpdatePayload>).detail);
  };
  bus.addEventListener(EVENT_NAME, handler);
  return () => bus.removeEventListener(EVENT_NAME, handler);
}
