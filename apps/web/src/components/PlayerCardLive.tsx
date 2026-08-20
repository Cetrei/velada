import type { Participant } from "@velada/core";
import PlayerCard from "./PlayerCard";

/**
 * Wrapper client:load de PlayerCard para /peleadores/[id]. Antes escuchaba
 * mmradarUpdateBus para refrescar en caliente el bloque de performance de
 * esta carta cuando MmradarPanel (columna derecha, isla de React separada)
 * disparaba "Actualizar" -- ese bloque de performance se quito por completo
 * de PlayerCard (ver ese archivo: mostrar performance en dos lugares de la
 * misma pagina era redundante, ahora vive solo en MmradarPanel), asi que ya
 * no hay nada que este wrapper necesite mantener sincronizado en vivo. Se
 * mantiene como wrapper (en vez de usar PlayerCard directo desde el .astro)
 * por si en el futuro vuelve a hacer falta un client:load con estado propio
 * para esta carta puntual.
 */

interface PlayerCardLiveProps {
  participantId: string;
  data: {
    name: string;
    nickname: string;
    mainRole: string;
    favChampion: string;
    lolRank?: string | null;
    photo?: string | null;
    banner?: string | null;
    stats?: Participant["stats"];
  };
  className?: string;
}

export default function PlayerCardLive({ data, className }: PlayerCardLiveProps) {
  return <PlayerCard data={data} className={className} />;
}
