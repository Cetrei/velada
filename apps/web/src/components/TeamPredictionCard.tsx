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
  const [justVotedFor, setJustVotedFor] = useState<"A" | "B" | null>(null);

  useEffect(() => {
    if (!teamMatch.id) return;
    const stored = getLocalVote(teamMatch.id);
    if (stored === "A" || stored === "B") setVotedFor(stored);
  }, [teamMatch.id]);

  const total = tally.totalVotes;
  const aPct = total > 0 ? Math.round((tally.teamAVotes / total) * 1000) / 10 : 50;
  const bPct = total > 0 ? Math.round((100 - aPct) * 10) / 10 : 50;

  async function vote(team: "A" | "B") {
    // Igual que en PredictionCard: se puede cambiar de equipo pronosticado
    // las veces que se quiera, solo se ignora tocar la opcion ya elegida.
    if (!teamMatch.id || isVoting || team === votedFor) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Error de conexión.");
      return;
    }

    const previousVote = votedFor;
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
    setJustVotedFor(team);
    window.setTimeout(() => setJustVotedFor(null), 500);

    setTally((prev) => {
      let { teamAVotes, teamBVotes, totalVotes } = prev;
      if (previousVote === "A") teamAVotes -= 1;
      if (previousVote === "B") teamBVotes -= 1;
      if (!previousVote) totalVotes += 1;
      if (team === "A") teamAVotes += 1;
      if (team === "B") teamBVotes += 1;
      return { ...prev, teamAVotes, teamBVotes, totalVotes };
    });
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
          hasVoted={votedFor !== null}
          justVoted={justVotedFor === "A"}
          isVoting={isVoting}
          onClick={() => vote("A")}
        />
        <TeamVoteButton
          label={PAGES.matches.teamBLabel}
          members={teamB}
          pct={bPct}
          isPicked={votedFor === "B"}
          hasVoted={votedFor !== null}
          justVoted={justVotedFor === "B"}
          isVoting={isVoting}
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
    </div>
  );
}

function TeamVoteButton({
  label,
  members,
  pct,
  isPicked,
  hasVoted,
  justVoted,
  isVoting,
  onClick,
  align = "left"
}: {
  label: string;
  members: Participant[];
  pct: number;
  isPicked: boolean;
  hasVoted: boolean;
  justVoted: boolean;
  isVoting: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  // Mismo affordance sin hover que FighterVoteButton en PredictionCard.tsx
  // (pedido del usuario: se aplica a "ambas variantes, 1v1 y equipo") --
  // mientras nadie voto todavia, borde punteado animado + icono de tap
  // flotante sobre la esquina del bloque, para que quede claro que el
  // bloque completo es clickeable sin tener que pasar el mouse primero.
  const showVotePrompt = !hasVoted && !isPicked;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isVoting}
      title={isPicked ? "Tocá el otro equipo para cambiar tu pronóstico" : "Tocá para pronosticar a este equipo"}
      className={`team-vote-btn relative flex-1 text-left disabled:cursor-default rounded-lg p-3 -m-1 border-2 transition-all duration-200 ${
        align === "right" ? "text-right" : ""
      } ${
        isPicked
          ? "border-lol-gold bg-lol-gold/10"
          : showVotePrompt
            ? "border-dashed border-lol-gold/40 hover:border-lol-gold/70 hover:bg-white/5 team-vote-prompt"
            : "border-transparent hover:border-lol-border hover:bg-white/5"
      } ${justVoted ? "team-vote-pulse" : ""}`}
    >
      {showVotePrompt && (
        <span
          className={`absolute -top-2 ${
            align === "right" ? "-left-2" : "-right-2"
          } w-5 h-5 rounded-full bg-lol-darkBg border border-lol-gold/70 flex items-center justify-center team-tap-hint`}
        >
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="#C8AA6E" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 11.5V4.5a1.5 1.5 0 1 1 3 0v5M12 9.5V3a1.5 1.5 0 1 1 3 0v6.5M15 9.5V5.2a1.5 1.5 0 1 1 3 0V13c0 4-2 7-6 7s-5.5-2-7-4.5l-1.4-2.4a1.4 1.4 0 0 1 2.2-1.7L8 14" />
          </svg>
        </span>
      )}
      <div className={`flex items-center gap-1.5 mb-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <p className={`text-white font-bold text-sm ${isPicked ? "text-lol-gold" : ""}`}>{label}</p>
        {isPicked && (
          <span className="w-4 h-4 rounded-full bg-lol-gold flex items-center justify-center check-pop shrink-0">
            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="#0A1428" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
            </svg>
          </span>
        )}
      </div>
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
      <style>{`
        @keyframes teamVotePulse {
          0% { transform: scale(1); }
          40% { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
        .team-vote-pulse {
          animation: teamVotePulse 0.4s ease-out;
        }
        @keyframes checkPop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .check-pop {
          animation: checkPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes teamTapHintPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.75; }
        }
        .team-tap-hint {
          animation: teamTapHintPulse 1.8s ease-in-out infinite;
        }
        @keyframes teamVotePromptBorder {
          0%, 100% { border-color: rgba(200, 170, 110, 0.4); }
          50% { border-color: rgba(200, 170, 110, 0.75); }
        }
        .team-vote-prompt {
          animation: teamVotePromptBorder 1.8s ease-in-out infinite;
        }
        .team-vote-btn:not(:disabled) {
          cursor: pointer;
        }
      `}</style>
    </button>
  );
}
