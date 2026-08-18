import type { Match, Participant, PredictionTally } from "@velada/core";
import { PAGES } from "@velada/core";
import PredictionCard from "./PredictionCard";

interface PredictionsSectionProps {
  matches: Match[];
  participantsById: Record<string, Participant>;
  tallies: Record<string, PredictionTally>;
}

const copy = PAGES.predictions;

export default function PredictionsSection({ matches, participantsById, tallies }: PredictionsSectionProps) {
  const renderable = matches
    .filter((m) => m.id)
    .map((m) => ({
      match: m,
      player1: participantsById[m.player1Id],
      player2: participantsById[m.player2Id]
    }))
    .filter((entry): entry is { match: Match; player1: Participant; player2: Participant } =>
      Boolean(entry.player1 && entry.player2)
    );

  if (renderable.length === 0) {
    return <p className="text-center text-slate-500">{copy.emptyState}</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {renderable.map(({ match, player1, player2 }) => (
        <PredictionCard
          key={match.id}
          match={match}
          player1={player1}
          player2={player2}
          initialTally={
            tallies[match.id as string] ?? {
              matchId: match.id as string,
              player1Votes: 0,
              player2Votes: 0,
              totalVotes: 0
            }
          }
        />
      ))}
    </div>
  );
}
