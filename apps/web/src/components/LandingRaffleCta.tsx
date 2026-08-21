import { useEffect, useState } from "react";
import type { Match } from "@velada/core";
import { PAGES } from "@velada/core";
import { hasUnseenRaffleResults } from "../lib/revealTracking";

interface LandingRaffleCtaProps {
  rouletteUnlocked: boolean;
  /** Combates ya sorteados (isRandom: true), para saber si hay resultados
   * pendientes de mostrarle a este visitante. */
  raffleMatches: Match[];
}

function matchKey(m: Match): string {
  return m.id ?? `${m.player1Id}-${m.player2Id}-${m.createdAt ?? ""}`;
}

/**
 * CTA de la seccion "Sorteo Oficial" del landing -- pedido del usuario
 * 2026-08-21: si el sorteo ya salio y este visitante todavia no lo vio,
 * en vez del CTA/subtitulo normal ("Entrar al sorteo en vivo" /
 * "Ver estado del sorteo") se le muestra "Ver el sorteo", empujandolo a
 * entrar y ver la revelacion secuencial en /sorteo. Una vez que ya la
 * vio (en cualquier pagina, mismo tracking que RouletteWheel/MatchesGate),
 * el landing vuelve a comportarse como siempre.
 *
 * Se decide en el cliente (localStorage) por eso es un componente React
 * separado en vez de logica directa en index.astro -- el server no sabe
 * que vio cada visitante.
 */
export default function LandingRaffleCta({ rouletteUnlocked, raffleMatches }: LandingRaffleCtaProps) {
  const copy = PAGES.home.raffle;
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    setHasUnseen(hasUnseenRaffleResults(raffleMatches.map(matchKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtitle = hasUnseen ? copy.subtitleUnseenResults : rouletteUnlocked ? copy.subtitleLive : copy.subtitleWaiting;
  const cta = hasUnseen ? copy.ctaUnseenResults : rouletteUnlocked ? copy.ctaLive : copy.ctaWaiting;

  return (
    <>
      <p className="text-slate-400 mb-8">{subtitle}</p>
      <a
        href="/sorteo"
        className="inline-block px-8 py-4 bg-gradient-to-r from-lol-gold to-yellow-600 hover:from-yellow-500 hover:to-yellow-400 text-black font-display font-bold text-lg transition-all transform hover:-translate-y-1 shadow-[0_10px_20px_rgba(200,170,110,0.3)] clip-edges uppercase tracking-wider"
      >
        {cta}
      </a>
    </>
  );
}
