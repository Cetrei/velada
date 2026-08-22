import type { Participant, TeamMatch, TeamPredictionTally } from "@velada/core";
import { PAGES } from "@velada/core";
import TeamPredictionCard from "./TeamPredictionCard";

interface TeamPredictionsSectionProps {
  teamMatches: TeamMatch[];
  participantsById: Record<string, Participant>;
  tallies: Record<string, TeamPredictionTally>;
}

const copy = PAGES.predictions;

export default function TeamPredictionsSection({ teamMatches, participantsById, tallies }: TeamPredictionsSectionProps) {
  const renderable = teamMatches
    .filter((tm) => tm.id)
    .map((tm) => ({
      teamMatch: tm,
      teamA: tm.teamAIds.map((id) => participantsById[id]).filter((p): p is Participant => Boolean(p)),
      teamB: tm.teamBIds.map((id) => participantsById[id]).filter((p): p is Participant => Boolean(p))
    }))
    .filter((entry) => entry.teamA.length > 0 && entry.teamB.length > 0);

  if (renderable.length === 0) {
    return <p className="text-center text-slate-500">{copy.teamsEmptyState}</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {renderable.map(({ teamMatch, teamA, teamB }) => (
        <TeamPredictionCard
          key={teamMatch.id}
          teamMatch={teamMatch}
          teamA={teamA}
          teamB={teamB}
          initialTally={
            tallies[teamMatch.id as string] ?? {
              teamMatchId: teamMatch.id as string,
              teamAVotes: 0,
              teamBVotes: 0,
              totalVotes: 0
            }
          }
        />
      ))}
    </div>
  );
}