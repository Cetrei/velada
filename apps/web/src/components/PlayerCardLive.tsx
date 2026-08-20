import { useEffect, useState } from "react";
import type { Participant, MmradarPerformanceScores } from "@velada/core";
import PlayerCard from "./PlayerCard";
import { onMmradarUpdate } from "../lib/mmradarUpdateBus";

/**
 * Wrapper client:load de PlayerCard para /peleadores/[id]: envuelve la
 * carta con un performanceRank que puede actualizarse en caliente cuando
 * el MmradarPanel de la columna derecha (isla de React SEPARADA, ver
 * lib/mmradarUpdateBus.ts) dispara "Actualizar". Sin esto, apretar
 * Actualizar en el panel de la derecha nunca movia la barra de
 * performance de esta carta sin recargar toda la pagina -- cada
 * client:load es su propia isla de React, no comparten estado entre si.
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
  initialPerformanceRank?: string | null;
  /**
   * Antes esta prop no existia: la barra de performance de PlayerCard
   * (agregada junto con este campo) nunca tenia con que dibujarse en
   * /peleadores/[id], porque ni el estado inicial (server-rendered) ni el
   * update en vivo via mmradarUpdateBus pasaban los 6 scores crudos, solo
   * el texto de performanceRank -- ver mmradarUpdateBus.ts y PlayerCard.tsx.
   */
  initialPerformanceScores?: MmradarPerformanceScores | null;
  className?: string;
}

export default function PlayerCardLive({
  participantId,
  data,
  initialPerformanceRank,
  initialPerformanceScores,
  className
}: PlayerCardLiveProps) {
  const [performanceRank, setPerformanceRank] = useState(initialPerformanceRank ?? null);
  const [performanceScores, setPerformanceScores] = useState(initialPerformanceScores ?? null);

  useEffect(() => {
    return onMmradarUpdate((payload) => {
      if (payload.participantId === participantId) {
        setPerformanceRank(payload.performanceRank);
        setPerformanceScores(payload.performanceScores);
      }
    });
  }, [participantId]);

  return <PlayerCard data={{ ...data, performanceRank, performanceScores }} className={className} />;
}
