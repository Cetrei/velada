import type { Participant } from "@velada/core";
import PlayerCard from "./PlayerCard";

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
