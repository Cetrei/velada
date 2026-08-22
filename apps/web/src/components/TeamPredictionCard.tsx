import { useEffect, useState } from "react";
import type { Participant, TeamMatch, TeamPredictionTally } from "@velada/core";
import { PAGES } from "@velada/core";
import { getSupabaseClient } from "../lib/supabase";
import { getLocalVote, getVoterId, setLocalVote } from "../lib/voterId";

interface TeamPredictionCardProps {
  teamMatch: TeamMatch;
  teamA: Participant[];
  teamB: Participant[];
  initialTally: TeamPredictionTally;
}

const copy = PAGES.predictions;

export default function TeamPredictionCard({ teamMatch, teamA, teamB, initialTally }: TeamPredictionCardProps) {
  const [tally, setTally] = useState(initialTally);
  const [votedFor, setVotedFor] = useState<"A" | "B" | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamMatch.id) return;
    const stored = getLocalVote(teamMatch.id);
    if (stored === "A" || stored === "B") setVotedFor(stored);
  }, [teamMatch.id]);

  const total = tally.totalVotes;
  const aPct = total > 0 ? Math.round((tally.teamAVotes / total) * 1000) / 10 : 50;
  const bPct = total > 0 ? Math.round((100 - aPct) * 10) / 10 : 50;

  async function vote(team: "A" | "B") {
    if (!teamMatch.id || isVoting || votedFor) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Error de conexión.");
      return;
    }

    setIsVoting(true);
    setError(null);
    const voterId = getVoterId();

    const { error: upsertError } = await supabase
      .from("team_predictions")
      .upsert(
        { team_match_id: teamMatch.id, voter_id: voterId, predicted_winner_team: team },
        { onConflict: "team_match_id,voter_id" }
      );

    setIsVoting(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setLocalVote(teamMatch.id, team);
    setVotedFor(team);
    setTally((prev) => ({
      ...prev,
      totalVotes: prev.totalVotes + 1,
      teamAVotes: team === "A" ? prev.teamAVotes + 1 : prev.teamAVotes,
      teamBVotes: team === "B" ? prev.teamBVotes + 1 : prev.teamBVotes
    }));
  }

  return (
    <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs uppercase text-slate-500 tracking-wide">{copy.communityLabel}</span>
        <span className="text-xs text-slate-500">{copy.votesLabel(total)}</span>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4">
        <TeamVoteButton
          label={PAGES.matches.teamALabel}
          members={teamA}
          pct={aPct}
          isPicked={votedFor === "A"}
          disabled={Boolean(votedFor) || isVoting}
          onClick={() => vote("A")}
        />
        <TeamVoteButton
          label={PAGES.matches.teamBLabel}
          members={teamB}
          pct={bPct}
          isPicked={votedFor === "B"}
          disabled={Boolean(votedFor) || isVoting}
          onClick={() => vote("B")}
          align="right"
        />
      </div>

      <div className="h-2.5 rounded-full overflow-hidden bg-lol-darkBg border border-lol-border/50 flex">
        <div
          className="h-full bg-gradient-to-r from-lol-gold to-yellow-400 transition-all duration-700 ease-out"
          style={{ width: `${aPct}%` }}
        />
        <div
          className="h-full bg-gradient-to-r from-lol-blue to-cyan-400 transition-all duration-700 ease-out"
          style={{ width: `${bPct}%` }}
        />
      </div>

      {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      {votedFor && <p className="text-lol-blue text-xs mt-3 uppercase tracking-wide font-bold">{copy.votedLabel}</p>}
    </div>
  );
}

function TeamVoteButton({
  label,
  members,
  pct,
  isPicked,
  disabled,
  onClick,
  align = "left"
}: {
  label: string;
  members: Participant[];
  pct: number;
  isPicked: boolean;
  disabled: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 text-left disabled:cursor-default ${
        align === "right" ? "text-right" : ""
      } ${!disabled ? "hover:opacity-80" : ""} transition-opacity`}
    >
      <p className={`text-white font-bold text-sm mb-1 ${isPicked ? "text-lol-gold" : ""}`}>{label}</p>
      <p
        className={`font-display font-bold text-xl sm:text-2xl ${
          align === "right" ? "text-lol-blue" : "text-lol-gold"
        }`}
      >
        {pct}%
      </p>
      <ul className={`text-xs text-slate-400 mt-1 space-y-0.5 ${align === "right" ? "text-right" : ""}`}>
        {members.map((m) => (
          <li key={m.id} className="truncate">
            {m.name}
          </li>
        ))}
      </ul>
    </button>
  );
}