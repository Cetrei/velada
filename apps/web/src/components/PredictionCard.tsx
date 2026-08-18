import { useEffect, useState } from "react";
import type { Match, Participant, PredictionTally } from "@velada/core";
import { PAGES } from "@velada/core";
import { getSupabaseClient } from "../lib/supabase";
import { getLocalVote, getVoterId, setLocalVote } from "../lib/voterId";

interface PredictionCardProps {
  match: Match;
  player1: Participant;
  player2: Participant;
  initialTally: PredictionTally;
}

function fallbackPhoto(p: Participant): string {
  return `https://placehold.co/100x100/0A1428/C8AA6E?text=${encodeURIComponent(p.nickname[0] ?? "?")}`;
}

const copy = PAGES.predictions;

export default function PredictionCard({ match, player1, player2, initialTally }: PredictionCardProps) {
  const [tally, setTally] = useState(initialTally);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!match.id) return;
    setVotedFor(getLocalVote(match.id));
  }, [match.id]);

  const total = tally.totalVotes;
  const p1Pct = total > 0 ? Math.round((tally.player1Votes / total) * 1000) / 10 : 50;
  const p2Pct = total > 0 ? Math.round((100 - p1Pct) * 10) / 10 : 50;

  async function vote(winnerId: string) {
    if (!match.id || isVoting || votedFor) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError(PAGES.admin ? "Supabase no está configurado." : "Error de conexión.");
      return;
    }

    setIsVoting(true);
    setError(null);
    const voterId = getVoterId();

    const { error: upsertError } = await supabase
      .from("predictions")
      .upsert(
        { match_id: match.id, voter_id: voterId, predicted_winner_id: winnerId },
        { onConflict: "match_id,voter_id" }
      );

    setIsVoting(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setLocalVote(match.id, winnerId);
    setVotedFor(winnerId);
    setTally((prev) => ({
      ...prev,
      totalVotes: prev.totalVotes + 1,
      player1Votes: winnerId === player1.id ? prev.player1Votes + 1 : prev.player1Votes,
      player2Votes: winnerId === player2.id ? prev.player2Votes + 1 : prev.player2Votes
    }));
  }

  return (
    <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs uppercase text-slate-500 tracking-wide">{copy.communityLabel}</span>
        <span className="text-xs text-slate-500">{copy.votesLabel(total)}</span>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4">
        <FighterVoteButton
          participant={player1}
          pct={p1Pct}
          isWinner={votedFor === player1.id}
          disabled={Boolean(votedFor) || isVoting}
          onClick={() => vote(player1.id)}
        />
        <FighterVoteButton
          participant={player2}
          pct={p2Pct}
          isWinner={votedFor === player2.id}
          disabled={Boolean(votedFor) || isVoting}
          onClick={() => vote(player2.id)}
          align="right"
        />
      </div>

      <div className="h-2.5 rounded-full overflow-hidden bg-lol-darkBg border border-lol-border/50 flex">
        <div
          className="h-full bg-gradient-to-r from-lol-gold to-yellow-400 transition-all duration-700 ease-out"
          style={{ width: `${p1Pct}%` }}
        />
        <div
          className="h-full bg-gradient-to-r from-lol-blue to-cyan-400 transition-all duration-700 ease-out"
          style={{ width: `${p2Pct}%` }}
        />
      </div>

      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      {votedFor && <p className="text-lol-blue text-xs mt-3 uppercase tracking-wide font-bold">{copy.votedLabel}</p>}
    </div>
  );
}

function FighterVoteButton({
  participant,
  pct,
  isWinner,
  disabled,
  onClick,
  align = "left"
}: {
  participant: Participant;
  pct: number;
  isWinner: boolean;
  disabled: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex items-center gap-3 text-left disabled:cursor-default ${
        align === "right" ? "flex-row-reverse text-right" : ""
      } ${!disabled ? "hover:opacity-80" : ""} transition-opacity`}
    >
      <img
        src={participant.photo ?? fallbackPhoto(participant)}
        alt={participant.name}
        className={`w-12 h-12 rounded-full object-cover border-2 ${
          isWinner ? "border-lol-gold" : "border-lol-border"
        }`}
      />
      <div>
        <p className="text-white font-bold text-sm sm:text-base">{participant.name}</p>
        <p
          className={`font-display font-bold text-xl sm:text-2xl ${
            align === "right" ? "text-lol-blue" : "text-lol-gold"
          }`}
        >
          {pct}%
        </p>
      </div>
    </button>
  );
}
