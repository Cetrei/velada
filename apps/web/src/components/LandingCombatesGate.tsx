import { useEffect, useState } from "react";
import type { Match, Participant, TeamMatch } from "@velada/core";
import { PAGES } from "@velada/core";
import { hasUnseenRaffleResults, hasUnseenTeamMatches } from "../lib/revealTracking";
import MatchesGate from "./MatchesGate";
import TeamMatchesGate from "./TeamMatchesGate";
interface LandingCombatesGateProps {
  officialMatches: Match[];
  teamMatches: TeamMatch[];
  participantsById: Record<string, Participant>;
}

function matchKey(m: Match): string {
  return m.id ?? `${m.player1Id}-${m.player2Id}-${m.createdAt ?? ""}`;
}

function teamMatchKey(tm: TeamMatch): string {
  return tm.id ?? `${tm.teamAIds.join(",")}-${tm.teamBIds.join(",")}-${tm.createdAt ?? ""}`;
}

/**
 * Seccion "Combates" del landing -- pedido del usuario 2026-08-21: si ya
 * hay combates (1v1 y/o por equipo) generados pero este visitante todavia
 * no los vio, en vez del preview normal se le muestra una invitacion a
 * entrar a verlos primero (para no arruinarle la sorpresa con un preview
 * de tarjetas ya resueltas en el landing) -- una vez que ya los vio
 * (entrando a /combates o /sorteo, mismo tracking en las tres paginas), el
 * landing vuelve a mostrar el preview + tabs de siempre.
 *
 * Se decide en el cliente (localStorage), por eso arranca en un estado
 * "neutro" (loading null) e hidrata la decision real en el primer effect
 * -- evita mismatch entre el HTML servido por Astro y lo que React pinta,
 * ya que el servidor no tiene forma de saber que vio cada visitante.
 */
export default function LandingCombatesGate({ officialMatches, teamMatches, participantsById }: LandingCombatesGateProps) {
  const copy = PAGES.home.matches;
  const [hasUnseen, setHasUnseen] = useState<boolean | null>(null);

  useEffect(() => {
    const unseen1v1 = hasUnseenRaffleResults(officialMatches.map(matchKey));
    const unseenTeams = hasUnseenTeamMatches(teamMatches.map(teamMatchKey));
    setHasUnseen(unseen1v1 || unseenTeams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (officialMatches.length === 0 && teamMatches.length === 0) {
    return (
      <div className="combates-locked flex flex-col items-center justify-center text-center py-16 px-6 border border-lol-border/60 bg-black/20">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-lol-gold/70 mb-4"
        >
          <rect x="4" y="11" width="16" height="9" rx="1.5" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <h3 className="font-display text-xl md:text-2xl font-bold text-white uppercase tracking-widest mb-2">
          {PAGES.home.matches.lockedTitle}
        </h3>
        <p className="text-slate-400 max-w-md">{PAGES.home.matches.lockedSubtitle}</p>
      </div>
    );
  }

  // hasUnseen === null: primer render (SSR/pre-hidratacion), todavia no
  // se sabe que vio este visitante -- se muestra un placeholder neutro (ni
  // el preview ni la invitacion) para no arriesgar mostrarle brevemente el
  // mensaje equivocado a nadie; se resuelve al toque en el primer effect.
  if (hasUnseen === null) {
    return <div className="h-16" aria-hidden="true" />;
  }

  if (hasUnseen) {
    return (
      <div className="combates-locked flex flex-col items-center justify-center text-center py-16 px-6 border border-lol-gold/40 bg-lol-gold/[0.04]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-lol-gold mb-4"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
        <h3 className="font-display text-xl md:text-2xl font-bold text-white uppercase tracking-widest mb-2">
          {copy.unseenTitle}
        </h3>
        <p className="text-slate-400 max-w-md mb-6">{copy.unseenSubtitle}</p>
        <a
          href="/combates"
          className="inline-block px-8 py-3 bg-lol-gold/10 border border-lol-gold text-lol-gold hover:bg-lol-gold hover:text-lol-darkBg transition-all font-bold text-sm tracking-wide uppercase clip-edges"
        >
          {copy.unseenCta}
        </a>
      </div>
    );
  }

  return (
    <>
      <LandingMatchesTabs
        officialMatches={officialMatches}
        teamMatches={teamMatches}
        participantsById={participantsById}
      />
      <div className="text-center mt-8">
        <a
          href="/combates"
          className="inline-block px-8 py-3 bg-lol-gold/10 border border-lol-gold text-lol-gold hover:bg-lol-gold hover:text-lol-darkBg transition-all font-bold text-sm tracking-wide uppercase clip-edges"
        >
          {PAGES.home.matches.cta}
        </a>
      </div>
    </>
  );
}

/**
 * Tabs 1v1 / Equipos del landing, en Tailwind puro con estado en React en
 * vez del truco de radios+CSS scoped que usan combates.astro/index.astro
 * originalmente -- ese truco depende del scoped CSS que Astro inyecta a
 * los .astro que renderean el markup directamente, pero este bloque ahora
 * vive dentro de un componente React (LandingCombatesGate, con
 * client:load), y el CSS scoped de Astro no le llega a markup pintado por
 * React del otro lado del boundary. Con estado en React el active tab no
 * depende de ningun CSS externo, y de paso permite pasarle `active` a
 * cada gate directo por prop en vez de tener que leer el DOM (ver
 * useTabActive.ts, que sigue usandose en combates.astro donde el shell de
 * tabs si es Astro/CSS puro).
 */
function LandingMatchesTabs({
  officialMatches,
  teamMatches,
  participantsById
}: {
  officialMatches: Match[];
  teamMatches: TeamMatch[];
  participantsById: Record<string, Participant>;
}) {
  const [activeTab, setActiveTab] = useState<"1v1" | "teams">("1v1");

  return (
    <div>
      <div className="flex justify-center gap-2 mb-8">
        <button
          type="button"
          onClick={() => setActiveTab("1v1")}
          className={`px-6 py-2.5 border font-display font-bold text-xs uppercase tracking-wide transition-all ${
            activeTab === "1v1"
              ? "bg-lol-gold border-lol-gold text-lol-darkBg"
              : "border-lol-gold/30 text-slate-400 hover:text-lol-gold"
          }`}
        >
          {PAGES.matches.tab1v1}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("teams")}
          className={`px-6 py-2.5 border font-display font-bold text-xs uppercase tracking-wide transition-all ${
            activeTab === "teams"
              ? "bg-lol-gold border-lol-gold text-lol-darkBg"
              : "border-lol-gold/30 text-slate-400 hover:text-lol-gold"
          }`}
        >
          {PAGES.matches.tabTeams}
        </button>
      </div>

      <div className={activeTab === "1v1" ? "block" : "hidden"}>
        <MatchesGate matches={officialMatches} participantsById={participantsById} forceActive={activeTab === "1v1"} />
      </div>
      <div className={activeTab === "teams" ? "block" : "hidden"}>
        <TeamMatchesGate teamMatches={teamMatches} participantsById={participantsById} forceActive={activeTab === "teams"} />
      </div>
    </div>
  );
}
