import { useMemo, useState } from "react";
import type { Participant } from "@velada/core";
import { PAGES } from "@velada/core";
import FighterLikeButton from "./FighterLikeButton";

interface FighterLikesSectionProps {
  participants: Participant[];
  initialCounts: Record<string, number>;
}

const copy = PAGES.predictions;

function fallbackPhoto(p: Participant): string {
  return `https://placehold.co/100x100/0A1428/C8AA6E?text=${encodeURIComponent(p.nickname[0] ?? "?")}`;
}

/**
 * Ranking de peleadores por likes, tab nuevo de /pronosticos (pedido del
 * usuario 2026-08-21, junto a "1 vs 1" y "Por equipos"). El orden se
 * recalcula en el cliente cada vez que un FighterLikeButton reporta su
 * nuevo contador via onCountChange -- no hay refetch ni suscripcion
 * realtime, es el mismo estado optimista que el boton ya mantiene,
 * levantado aca solo para poder reordenar la lista completa.
 */
export default function FighterLikesSection({ participants, initialCounts }: FighterLikesSectionProps) {
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts);

  const ranked = useMemo(
    () =>
      [...participants].sort((a, b) => {
        const diff = (counts[b.id] ?? 0) - (counts[a.id] ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      }),
    [participants, counts]
  );

  if (participants.length === 0) {
    return <p className="text-center text-slate-500">{copy.likesEmptyState}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {ranked.map((p, index) => (
        <div
          key={p.id}
          className="fighter-like-row flex items-center gap-4 bg-lol-cardBg border border-lol-border rounded-xl px-4 py-3"
        >
          <span className="w-6 text-center font-display font-bold text-lol-gold/80 text-sm shrink-0">
            {index + 1}
          </span>
          <a href={`/peleadores/${p.id}`} className="flex items-center gap-3 flex-1 min-w-0 group">
            <img
              src={p.photo ?? fallbackPhoto(p)}
              alt={p.name}
              className="w-11 h-11 rounded-full object-cover border-2 border-lol-border shrink-0"
            />
            <div className="min-w-0">
              <p className="text-white font-bold text-sm truncate group-hover:text-lol-gold transition-colors">
                {p.name}
              </p>
              <p className="text-slate-500 text-xs truncate">{p.nickname}</p>
            </div>
          </a>
          <FighterLikeButton
            participantId={p.id}
            initialLikes={initialCounts[p.id] ?? 0}
            size="lg"
            onCountChange={(next) => setCounts((prev) => ({ ...prev, [p.id]: next }))}
          />
        </div>
      ))}
    </div>
  );
}
