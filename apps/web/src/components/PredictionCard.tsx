import { useEffect, useState } from "react";
import type { Match, Participant, PredictionTally } from "@velada/core";
import { PAGES } from "@velada/core";
import { getSupabaseClient } from "../lib/supabase";
import { getLocalVote, getVoterId, setLocalVote } from "../lib/voterId";
import FighterLikeButton from "./FighterLikeButton";

interface PredictionCardProps {
  match: Match;
  player1: Participant;
  player2: Participant;
  initialTally: PredictionTally;
  initialLikes?: Record<string, number>;
}

function fallbackPhoto(p: Participant): string {
  return `https://placehold.co/100x100/0A1428/C8AA6E?text=${encodeURIComponent(p.nickname[0] ?? "?")}`;
}

const copy = PAGES.predictions;

export default function PredictionCard({ match, player1, player2, initialTally, initialLikes }: PredictionCardProps) {
  const [tally, setTally] = useState(initialTally);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justVotedFor, setJustVotedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!match.id) return;
    setVotedFor(getLocalVote(match.id));
  }, [match.id]);

  const total = tally.totalVotes;
  const p1Pct = total > 0 ? Math.round((tally.player1Votes / total) * 1000) / 10 : 50;
  const p2Pct = total > 0 ? Math.round((100 - p1Pct) * 10) / 10 : 50;
  const hasVoted = votedFor !== null;

  async function vote(winnerId: string) {
    // votedFor ya NO bloquea un segundo click: el usuario puede cambiar de
    // pronostico las veces que quiera mientras el combate siga abierto a
    // votacion. Solo se ignora un click sobre la opcion ya elegida (no hay
    // nada que cambiar) o mientras hay una escritura en curso.
    if (!match.id || isVoting || winnerId === votedFor) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError(PAGES.admin ? "Supabase no está configurado." : "Error de conexión.");
      return;
    }

    const previousVote = votedFor;
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
    setJustVotedFor(winnerId);
    window.setTimeout(() => setJustVotedFor(null), 500);

    // El tally se ajusta a mano: resta el voto anterior (si lo habia,
    // porque el usuario esta cambiando de opinion) y suma el nuevo, sin
    // esperar un refetch completo de Supabase.
    setTally((prev) => {
      let { player1Votes, player2Votes, totalVotes } = prev;
      if (previousVote === player1.id) player1Votes -= 1;
      if (previousVote === player2.id) player2Votes -= 1;
      if (!previousVote) totalVotes += 1;
      if (winnerId === player1.id) player1Votes += 1;
      if (winnerId === player2.id) player2Votes += 1;
      return { ...prev, player1Votes, player2Votes, totalVotes };
    });
  }

  return (
    <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs uppercase text-slate-500 tracking-wide">{copy.communityLabel}</span>
        <span className="text-xs text-slate-500">{copy.votesLabel(total)}</span>
      </div>

      <div className="flex items-start justify-between gap-3 mb-4">
        <FighterVoteButton
          participant={player1}
          pct={p1Pct}
          isPicked={votedFor === player1.id}
          hasVoted={hasVoted}
          justVoted={justVotedFor === player1.id}
          isVoting={isVoting}
          onClick={() => vote(player1.id)}
          likeCount={initialLikes?.[player1.id] ?? 0}
        />
        <FighterVoteButton
          participant={player2}
          pct={p2Pct}
          isPicked={votedFor === player2.id}
          hasVoted={hasVoted}
          justVoted={justVotedFor === player2.id}
          isVoting={isVoting}
          onClick={() => vote(player2.id)}
          likeCount={initialLikes?.[player2.id] ?? 0}
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
    </div>
  );
}

function FighterVoteButton({
  participant,
  pct,
  isPicked,
  hasVoted,
  justVoted,
  isVoting,
  onClick,
  likeCount,
  align = "left"
}: {
  participant: Participant;
  pct: number;
  isPicked: boolean;
  hasVoted: boolean;
  justVoted: boolean;
  isVoting: boolean;
  onClick: () => void;
  likeCount: number;
  align?: "left" | "right";
}) {
  // Affordance SIN depender de hover ni de texto: mientras nadie voto
  // todavia (hasVoted === false), TODOS los botones muestran un borde
  // punteado + un icono de "tocar" flotando sobre la foto, para que sea
  // obvio que ahi se puede votar sin tener que pasar el mouse primero
  // (pedido del usuario: "hay que adivinar que poniendo el mouse ahi se
  // puede votar"). Una vez que ya se voto por alguien, ese indicio
  // desaparece de ambos botones y el elegido pasa a mostrar el check
  // dorado; el no elegido vuelve a un borde neutro con hover normal
  // (ya quedo claro que esto es votable, no hace falta seguir insistiendo).
  const showVotePrompt = !hasVoted && !isPicked;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isVoting}
      title={isPicked ? "Tocá al rival para cambiar tu pronóstico" : "Tocá para pronosticar a este peleador"}
      className={`vote-btn flex flex-col items-center gap-2 text-center disabled:cursor-default rounded-lg p-2 border-2 transition-all duration-200 flex-1 min-w-0 ${
        isPicked
          ? "border-lol-gold bg-lol-gold/10"
          : showVotePrompt
            ? "border-dashed border-lol-gold/40 hover:border-lol-gold/70 hover:bg-white/5 vote-prompt"
            : "border-transparent hover:border-lol-border hover:bg-white/5"
      } ${justVoted ? "vote-pulse" : ""}`}
    >
      <span className="relative shrink-0">
        <img
          src={participant.photo ?? fallbackPhoto(participant)}
          alt={participant.name}
          className={`w-14 h-14 rounded-full object-cover border-2 transition-colors duration-200 ${
            isPicked ? "border-lol-gold" : "border-lol-border"
          }`}
        />
        {isPicked && (
          <span
            className={`absolute -bottom-1 ${
              align === "right" ? "-left-1" : "-right-1"
            } w-5 h-5 rounded-full bg-lol-gold flex items-center justify-center check-pop`}
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="#0A1428" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
            </svg>
          </span>
        )}
        {/* Like sobre la esquina de la foto, no al lado del nombre: con
            nombres largos el boton al lado del texto se superponia
            (bug reportado). Absoluto y compacto, no empuja el layout. */}
        {participant.id && (
          <span className={`absolute -bottom-1.5 ${align === "right" ? "-right-1.5" : "-left-1.5"}`}>
            <FighterLikeButton participantId={participant.id} initialLikes={likeCount} size="xs" />
          </span>
        )}
      </span>
      <div className="min-w-0 w-full">
        <p className="text-white font-bold text-xs sm:text-sm truncate px-1">{participant.name}</p>
        <p
          className={`font-display font-bold text-lg sm:text-xl ${
            align === "right" ? "text-lol-blue" : "text-lol-gold"
          }`}
        >
          {pct}%
        </p>
      </div>
      <style>{`
        @keyframes votePulse {
          0% { transform: scale(1); }
          40% { transform: scale(1.04); }
          100% { transform: scale(1); }
        }
        .vote-pulse {
          animation: votePulse 0.4s ease-out;
        }
        @keyframes checkPop {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .check-pop {
          animation: checkPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes votePromptBorder {
          0%, 100% { border-color: rgba(200, 170, 110, 0.4); }
          50% { border-color: rgba(200, 170, 110, 0.75); }
        }
        .vote-prompt {
          animation: votePromptBorder 1.8s ease-in-out infinite;
        }
        .vote-btn:not(:disabled) {
          cursor: pointer;
        }
      `}</style>
    </button>
  );
}
