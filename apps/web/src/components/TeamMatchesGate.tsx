import { useEffect, useState } from "react";
import type { Participant, TeamMatch } from "@velada/core";
import { PAGES, rankIconPath } from "@velada/core";
import { hasUnseenTeamMatches, markTeamMatchesSeen } from "../lib/revealTracking";
import { useTabActive } from "../lib/useTabActive";
import SequentialReveal from "./SequentialReveal";

interface TeamMatchesGateProps {
  teamMatches: TeamMatch[];
  participantsById: Record<string, Participant>;
  /** Ver la misma doc en MatchesGateProps -- coordina el pausado del
   * timer con el sistema de tabs de CSS puro de /combates. */
  tabRadioGroup?: string;
  tabPanelId?: string;
  /** Ver la misma doc en MatchesGateProps -- para cuando el padre ya
   * controla el tab activo directamente en React (LandingCombatesGate)
   * en vez del truco de radios+CSS. Tiene prioridad sobre tabRadioGroup/
   * tabPanelId si esta presente. */
  forceActive?: boolean;
}

/** Clave estable por team match para el tracking de "visto". */
function teamMatchKey(tm: TeamMatch): string {
  return tm.id ?? `${tm.teamAIds.join(",")}-${tm.teamBIds.join(",")}-${tm.createdAt ?? ""}`;
}

function TeamRosterMini({
  team,
  label,
  isWinner
}: {
  team: Participant[];
  label: string;
  isWinner: boolean;
}) {
  return (
    <div className={`bg-lol-cardBg p-3 sm:p-4 ${isWinner ? "ring-1 ring-inset ring-lol-gold/60" : ""}`}>
      <p className={`text-xs uppercase tracking-wide mb-2 ${isWinner ? "text-lol-gold" : "text-slate-500"}`}>
        {label}
        {isWinner && <span className="ml-1">★</span>}
      </p>
      <ul className="space-y-1.5">
        {team.map((p) => (
          <li key={p.id} className="flex items-center gap-2 min-w-0">
            <img
              src={rankIconPath(p.lolRank)}
              alt=""
              className="w-4 h-4 object-contain flex-shrink-0"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <span className={`truncate text-sm ${isWinner ? "text-white font-bold" : "text-slate-300"}`}>
              {p.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TeamMatchCard({
  teamMatch,
  teamA,
  teamB,
  copy
}: {
  teamMatch: TeamMatch;
  teamA: Participant[];
  teamB: Participant[];
  copy: typeof PAGES.matches;
}) {
  const winnerTeam = teamMatch.winnerTeam;
  const href = teamMatch.id ? `/combates/equipo/${teamMatch.id}` : null;
  const content = (
    <>
      {teamMatch.name && <p className="text-center text-xs uppercase tracking-wide text-slate-500 pt-3">{teamMatch.name}</p>}

      <div className="grid grid-cols-2 gap-px bg-lol-border/50 mt-3">
        <TeamRosterMini team={teamA} label={copy.teamALabel} isWinner={winnerTeam === "A"} />
        <TeamRosterMini team={teamB} label={copy.teamBLabel} isWinner={winnerTeam === "B"} />
      </div>

      <div className="relative -mt-4 flex justify-center z-20">
        <div className="w-10 h-10 bg-lol-darkBg border border-lol-gold rotate-45 flex items-center justify-center">
          <span className="text-lol-gold font-display font-bold text-xs -rotate-45">VS</span>
        </div>
      </div>

      <div className="px-6 pb-5 pt-2 text-center">
        {winnerTeam ? (
          <>
            <p className="text-xs uppercase text-slate-500 tracking-wide">{copy.teamWinnerLabel}</p>
            <p className="font-display text-lg font-bold text-lol-gold uppercase">
              {winnerTeam === "A" ? copy.teamALabel : copy.teamBLabel}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500 uppercase tracking-wide">{copy.pendingResult}</p>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} className="match-card-mini-clickable block bg-lol-cardBg border border-lol-border overflow-hidden clip-edges">
        {content}
      </a>
    );
  }

  return <div className="bg-lol-cardBg border border-lol-border overflow-hidden clip-edges">{content}</div>;
}

/**
 * Version cliente de TeamMatchesSection.astro con presentacion secuencial
 * en la primera visita -- pedido del usuario 2026-08-21: aunque los
 * combates por equipo no vienen de un sorteo con animacion propia (se
 * generan/cargan directo en el panel admin), la primera vez que un
 * visitante entra despues de que ya existen, se le muestran de a uno en
 * vez de la grilla plana, para dar la misma inmersividad que el sorteo
 * 1v1. Visitas siguientes van directo a la grilla normal.
 *
 * Necesita ser un componente React (no .astro) porque decide que mostrar
 * segun localStorage, que solo existe en el cliente -- TeamMatchesSection
 * sigue existiendo tal cual para /combates y el landing, este componente
 * es la version con gate para donde se pida esa inmersividad.
 */
export default function TeamMatchesGate({ teamMatches, participantsById, tabRadioGroup, tabPanelId, forceActive }: TeamMatchesGateProps) {
  const copy = PAGES.matches;

  const initialRef = useState(() => teamMatches)[0];
  // Arranca en null -- mismo fix que MatchesGate/RouletteWheel: resolver
  // hasUnseenTeamMatches ya en el useState inicial corria tambien en el
  // render de servidor de este componente client:load, y ahi localStorage
  // no existe (siempre "no visto" en el HTML inicial sin importar lo que
  // diga el localStorage real del visitante) -- eso causaba un flash de la
  // revelacion en visitas donde ya estaba todo visto.
  const [revealPending, setRevealPending] = useState<boolean | null>(null);
  const [revealIndex, setRevealIndex] = useState(0);
  const tabActiveFromDom = useTabActive(tabRadioGroup ?? "__no_tabs__", tabPanelId ?? "__no_tabs__");
  const tabActive = forceActive ?? tabActiveFromDom;

  useEffect(() => {
    setRevealPending(hasUnseenTeamMatches(initialRef.map(teamMatchKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finishReveal() {
    markTeamMatchesSeen(initialRef.map(teamMatchKey));
    setRevealPending(false);
  }

  if (teamMatches.length === 0) {
    return <p className="text-center text-slate-500">{copy.teamsEmptyState}</p>;
  }

  // revealPending === null: todavia no se resolvio el effect de arriba --
  // placeholder neutro, mismo criterio que MatchesGate.
  if (revealPending === null) {
    return <div className="h-64" aria-hidden="true" />;
  }

  if (revealPending && initialRef.length > 0) {
    const current = initialRef[Math.min(revealIndex, initialRef.length - 1)];
    const teamA = current.teamAIds.map((id) => participantsById[id]).filter((p): p is Participant => Boolean(p));
    const teamB = current.teamBIds.map((id) => participantsById[id]).filter((p): p is Participant => Boolean(p));

    return (
      <SequentialReveal
        total={initialRef.length}
        currentIndex={revealIndex}
        onAdvance={setRevealIndex}
        onFinished={finishReveal}
        eyebrow={copy.teamsRevealEyebrow}
        title={copy.teamsRevealTitle}
        skipCta={copy.teamsRevealSkipCta}
        active={tabActive}
      >
        <div className="max-w-md mx-auto">
          <TeamMatchCard teamMatch={current} teamA={teamA} teamB={teamB} copy={copy} />
        </div>
      </SequentialReveal>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
      {teamMatches.map((teamMatch) => {
        const teamA = teamMatch.teamAIds.map((id) => participantsById[id]).filter((p): p is Participant => Boolean(p));
        const teamB = teamMatch.teamBIds.map((id) => participantsById[id]).filter((p): p is Participant => Boolean(p));
        return (
          <TeamMatchCard key={teamMatch.id ?? teamMatchKey(teamMatch)} teamMatch={teamMatch} teamA={teamA} teamB={teamB} copy={copy} />
        );
      })}
    </div>
  );
}
