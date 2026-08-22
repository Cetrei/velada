import { useEffect, useState } from "react";
import { getSupabaseClient } from "../lib/supabase";
import { getVoterId, isLocallyLiked, setLocalLike } from "../lib/voterId";

interface FighterLikeButtonProps {
  participantId: string;
  initialLikes: number;
  /** "xs" como badge compacto sobre una foto (sin contador debajo, ver nota abajo), "sm" para usar suelto en tarjetas, "lg" para el tab de likes. */
  size?: "xs" | "sm" | "lg";
  /** Opcional: se llama con el nuevo contador tras cada toggle exitoso, para que un padre (ej. el ranking de FighterLikesSection) pueda reordenarse. */
  onCountChange?: (count: number) => void;
}

/**
 * Corazon de like/favorito por peleador. A diferencia del voto de
 * pronostico (una sola eleccion por combate), esto es un toggle libre: se
 * puede likear a cuantos peleadores se quiera, y se puede quitar el like
 * en cualquier momento (INSERT/DELETE sobre fighter_likes, no un upsert de
 * ganador unico). Estado local en localStorage (isLocallyLiked/
 * setLocalLike en voterId.ts) para pintar el corazon lleno sin tener que
 * volver a consultar Supabase en cada render.
 */
export default function FighterLikeButton({
  participantId,
  initialLikes,
  size = "sm",
  onCountChange
}: FighterLikeButtonProps) {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialLikes);
  const [isBusy, setIsBusy] = useState(false);
  const [justChanged, setJustChanged] = useState(false);

  useEffect(() => {
    setLiked(isLocallyLiked(participantId));
  }, [participantId]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isBusy) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const nextLiked = !liked;
    setIsBusy(true);

    // Optimista: la UI cambia antes de que vuelva la respuesta de
    // Supabase, y se revierte si falla. Con esto el corazon reacciona al
    // instante en vez de esperar el round-trip de red.
    setLiked(nextLiked);
    const optimisticCount = nextLiked ? count + 1 : Math.max(0, count - 1);
    setCount(optimisticCount);
    setJustChanged(true);

    const voterId = getVoterId();
    const { error } = nextLiked
      ? await supabase.from("fighter_likes").insert({ participant_id: participantId, voter_id: voterId })
      : await supabase.from("fighter_likes").delete().eq("participant_id", participantId).eq("voter_id", voterId);

    setIsBusy(false);

    if (error) {
      // Revertir el optimismo si la escritura real fallo.
      setLiked(!nextLiked);
      setCount(count);
      return;
    }

    setLocalLike(participantId, nextLiked);
    onCountChange?.(optimisticCount);
    window.setTimeout(() => setJustChanged(false), 400);
  }

  // "xs" es un badge redondo compacto (icono solo, sin numero de
  // contador debajo -- pensado para superponerse a la esquina de una
  // foto ya chica, como en PredictionCard, donde apilar icono+numero no
  // entra). "sm"/"lg" mantienen el layout icono-arriba/numero-abajo.
  const isCompact = size === "xs";
  const dims = size === "lg" ? "w-11 h-11" : size === "sm" ? "w-8 h-8" : "w-6 h-6";
  const iconDims = size === "lg" ? "w-5 h-5" : size === "sm" ? "w-4 h-4" : "w-3 h-3";
  const textSize = size === "lg" ? "text-sm" : "text-xs";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isBusy}
      aria-pressed={liked}
      aria-label={liked ? `Quitar like (${count})` : `Dar like (${count})`}
      title={liked ? "Quitar like" : "Dar like"}
      className={`fighter-like-btn flex flex-col items-center gap-0.5 group ${isBusy ? "opacity-70" : ""}`}
    >
      <span
        className={`${dims} rounded-full flex items-center justify-center border transition-colors duration-200 ${
          liked
            ? "border-lol-gold bg-lol-gold/90"
            : isCompact
              ? "border-lol-gold/70 bg-lol-darkBg group-hover:border-lol-gold"
              : "border-lol-border bg-lol-darkBg group-hover:border-lol-gold/60"
        } ${justChanged ? "like-pop" : ""}`}
      >
        <svg
          viewBox="0 0 24 24"
          className={iconDims}
          fill={liked ? (isCompact ? "#0A1428" : "#C8AA6E") : "none"}
          stroke={liked ? (isCompact ? "#0A1428" : "#C8AA6E") : isCompact ? "#C8AA6E" : "#94a3b8"}
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 20.5s-7.5-4.6-10-9.2C.5 8 2 4.5 5.5 4c2-.3 3.8.7 4.9 2.3C11.5 4.7 13.3 3.7 15.3 4c3.5.5 5 4 3.5 7.3-2.5 4.6-10 9.2-10 9.2z"
          />
        </svg>
      </span>
      {!isCompact && <span className={`${textSize} font-bold text-slate-400 tabular-nums`}>{count}</span>}
      <style>{`
        @keyframes likePop {
          0% { transform: scale(1); }
          35% { transform: scale(1.35); }
          60% { transform: scale(0.92); }
          100% { transform: scale(1); }
        }
        .like-pop {
          animation: likePop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .fighter-like-btn {
          cursor: pointer;
        }
      `}</style>
    </button>
  );
}
