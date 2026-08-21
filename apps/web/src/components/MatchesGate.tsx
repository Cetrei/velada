import { useState } from "react";
import type { Match, Participant } from "@velada/core";
import { PAGES } from "@velada/core";
import { hasUnseenRaffleResults, markRaffleResultsSeen } from "../lib/revealTracking";
import { useTabActive } from "../lib/useTabActive";
import SequentialReveal from "./SequentialReveal";

interface MatchesGateProps {
  matches: Match[];
  participantsById: Record<string, Participant>;
  /**
   * Si este panel vive detras de un tab de CSS puro (ver combates.astro),
   * el name del grupo de radios y el id del radio de ESTE panel -- se usa
   * para pausar el timer de la revelacion mientras el tab no esta activo.
   * Sin esto, se asume que el panel siempre esta visible (ej. si se usa
   * suelto sin tabs). Ignorado si se pasa `forceActive`.
   */
  tabRadioGroup?: string;
  tabPanelId?: string;
  /**
   * Alternativa a tabRadioGroup/tabPanelId para cuando el padre ya
   * controla el tab activo directamente en React (ver
   * LandingCombatesGate) en vez de con el truco de radios+CSS -- si se
   * pasa, tiene prioridad sobre tabRadioGroup/tabPanelId.
   */
  forceActive?: boolean;
}

function matchKey(m: Match): string {
  return m.id ?? `${m.player1Id}-${m.player2Id}-${m.createdAt ?? ""}`;
}

function FighterHalfMini({
  participant,
  isWinner,
  align
}: {
  participant: Participant;
  isWinner: boolean;
  align: "left" | "right";
}) {
  const fallback = `https://placehold.co/400x500/0A1428/C8AA6E?text=${encodeURIComponent(participant.nickname)}`;
  return (
    <div className="relative h-48 sm:h-56 overflow-hidden">
      <img
        src={participant.photo ?? fallback}
        alt={participant.name}
        loading="lazy"
        className={`w-full h-full object-cover ${!isWinner ? "grayscale-[0.4] opacity-80" : ""}`}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-lol-cardBg via-transparent to-transparent" />
      {isWinner && (
        <span className="absolute top-2 inset-x-0 text-center">
          <span className="inline-block px-2 py-0.5 bg-lol-gold text-lol-darkBg text-[10px] font-bold uppercase tracking-wide rounded-sm">
            ★
          </span>
        </span>
      )}
      <span
        className={`absolute bottom-2 ${align === "left" ? "left-2" : "right-2 text-right"} text-white font-display font-bold text-sm sm:text-base uppercase drop-shadow-lg`}
      >
        {participant.name}
      </span>
    </div>
  );
}

function MatchResultCardMini({
  match,
  player1,
  player2,
  copy
}: {
  match: Match;
  player1: Participant;
  player2: Participant;
  copy: typeof PAGES.matches;
}) {
  const winner = match.winnerId === player1.id ? player1 : match.winnerId === player2.id ? player2 : null;
  return (
    <div className="bg-lol-cardBg border border-lol-border overflow-hidden clip-edges">
      <div className="grid grid-cols-2">
        <FighterHalfMini participant={player1} isWinner={winner?.id === player1.id} align="left" />
        <FighterHalfMini participant={player2} isWinner={winner?.id === player2.id} align="right" />
      </div>

      <div className="relative -mt-6 flex justify-center z-20">
        <div className="w-10 h-10 bg-lol-darkBg border border-lol-gold rotate-45 flex items-center justify-center">
          <span className="text-lol-gold font-display font-bold text-xs -rotate-45">VS</span>
        </div>
      </div>

      <div className="px-6 pb-5 pt-2 text-center">
        {winner ? (
          <>
            <p className="text-xs uppercase text-slate-500 tracking-wide">{copy.winnerLabel}</p>
            <p className="font-display text-lg font-bold text-lol-gold uppercase">{winner.name}</p>
            {match.decision && <p className="text-xs text-slate-500 mt-1">{match.decision}</p>}
          </>
        ) : (
          <p className="text-sm text-slate-500 uppercase tracking-wide">{copy.pendingResult}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Version cliente de MatchesSection.astro con presentacion secuencial en
 * la primera visita, para cuando alguien llega directo a /combates (sin
 * pasar por /sorteo) y todavia no vio los resultados del sorteo -- mismo
 * criterio de "visto" que RouletteWheel (misma clave localStorage via
 * revealTracking.ts), asi que ver la revelacion en cualquiera de las dos
 * paginas marca el sorteo como visto en la otra tambien.
 */
export default function MatchesGate({ matches, participantsById, tabRadioGroup, tabPanelId, forceActive }: MatchesGateProps) {
  const copy = PAGES.matches;
  const raffleCopy = PAGES.raffle;

  const renderable = matches
    .map((m) => ({ match: m, player1: participantsById[m.player1Id], player2: participantsById[m.player2Id] }))
    .filter(
      (entry): entry is { match: Match; player1: Participant; player2: Participant } =>
        Boolean(entry.player1 && entry.player2)
    );

  const initialRef = useState(() => renderable)[0];
  const [revealPending, setRevealPending] = useState(() =>
    hasUnseenRaffleResults(initialRef.map((r) => matchKey(r.match)))
  );
  const [revealIndex, setRevealIndex] = useState(0);
  const tabActiveFromDom = useTabActive(tabRadioGroup ?? "__no_tabs__", tabPanelId ?? "__no_tabs__");
  const tabActive = forceActive ?? tabActiveFromDom;

  function finishReveal() {
    markRaffleResultsSeen(initialRef.map((r) => matchKey(r.match)));
    setRevealPending(false);
  }

  if (renderable.length === 0) {
    return <p className="text-center text-slate-500">{copy.emptyState}</p>;
  }

  if (revealPending && initialRef.length > 0) {
    const current = initialRef[Math.min(revealIndex, initialRef.length - 1)];

    return (
      <SequentialReveal
        total={initialRef.length}
        currentIndex={revealIndex}
        onAdvance={setRevealIndex}
        onFinished={finishReveal}
        eyebrow={raffleCopy.revealEyebrow}
        title={raffleCopy.revealTitle}
        skipCta={raffleCopy.revealSkipCta}
        active={tabActive}
      >
        <div className="max-w-md mx-auto">
          <MatchResultCardMini match={current.match} player1={current.player1} player2={current.player2} copy={copy} />
        </div>
      </SequentialReveal>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
      {renderable.map(({ match, player1, player2 }) => (
        <MatchResultCardMini key={matchKey(match)} match={match} player1={player1} player2={player2} copy={copy} />
      ))}
    </div>
  );
}
