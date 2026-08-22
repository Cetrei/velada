import { computeOverallWinComparison, type OverallComparisonInput } from "@velada/core";
import { PAGES } from "@velada/core";

export interface MatchComparisonFighter {
  name: string;
  photo?: string | null;
  duelRating?: number | null;
  performanceRank?: string | null;
  lolRank?: string | null;
}

interface MatchComparisonCardProps {
  playerA: MatchComparisonFighter;
  playerB: MatchComparisonFighter;
}

const copy = PAGES.matchDetail;

function fallbackPhoto(name: string): string {
  return `https://placehold.co/100x100/0A1428/C8AA6E?text=${encodeURIComponent(name[0] ?? "?")}`;
}

function toInput(f: MatchComparisonFighter): OverallComparisonInput {
  return { duelRating: f.duelRating, performanceRank: f.performanceRank, lolRank: f.lolRank };
}

/**
 * Comparacion visual de dos peleadores segun Performance y Habilidad 1v1
 * combinados, para la pagina de detalle de un combate 1v1
 * (/combates/[id]) -- pedido del usuario 2026-08-21: "una comparacion de
 * sus performances y sus duel rank... con esos dos que esteticamente se
 * muestre quien es el mas probable a ganar bajo esos dos factores
 * (proporcional a la diferencia de nivel)".
 *
 * Muestra 3 barras: la combinada arriba (la mas grande/destacada, el
 * "veredicto") y las dos individuales (Performance, 1v1) abajo como
 * desglose de por que salio esa combinada -- mismo espiritu que
 * DuelRatingCard, que ya usa esta idea de barra dividida self/rival.
 */
export default function MatchComparisonCard({ playerA, playerB }: MatchComparisonCardProps) {
  const hasAnyData =
    Boolean(playerA.duelRating || playerA.performanceRank || playerA.lolRank) &&
    Boolean(playerB.duelRating || playerB.performanceRank || playerB.lolRank);

  const result = computeOverallWinComparison(toInput(playerA), toInput(playerB));

  const showLowDataHint =
    !playerA.performanceRank || !playerB.performanceRank || !playerA.duelRating || !playerB.duelRating;

  return (
    <div className="comparison-card">
      <div className="comparison-header">
        <span className="comparison-title">{copy.comparisonTitle}</span>
        <span className="comparison-subtitle">{copy.comparisonSubtitle}</span>
      </div>

      <div className="comparison-main-row">
        <FighterMini fighter={playerA} align="left" />
        <div className="comparison-main-pcts">
          <span className={`comparison-main-pct ${result.playerAWinPct >= result.playerBWinPct ? "is-favored" : ""}`}>
            {result.playerAWinPct}%
          </span>
          <span className="comparison-main-vs">VS</span>
          <span className={`comparison-main-pct comparison-main-pct-rival ${result.playerBWinPct > result.playerAWinPct ? "is-favored" : ""}`}>
            {result.playerBWinPct}%
          </span>
        </div>
        <FighterMini fighter={playerB} align="right" />
      </div>

      <div className="comparison-main-track">
        <div className="comparison-main-fill-a" style={{ width: `${result.playerAWinPct}%` }} />
        <div className="comparison-main-fill-b" style={{ width: `${result.playerBWinPct}%` }} />
      </div>
      <p className="comparison-main-caption">{copy.comparisonCaption}</p>

      <div className="comparison-breakdown">
        <ComparisonRow
          label={copy.performanceCompareLabel}
          aPct={result.performance.playerAWinPct}
          bPct={result.performance.playerBWinPct}
        />
        <ComparisonRow label={copy.duelCompareLabel} aPct={result.duel.playerAWinPct} bPct={result.duel.playerBWinPct} />
      </div>

      {showLowDataHint && hasAnyData && <p className="comparison-hint">{copy.noDataHint}</p>}

      <style>{`
        .comparison-card {
          background: var(--lol-card-bg, #0A1428);
          border: 1px solid rgba(200, 170, 110, 0.25);
          padding: 24px;
        }

        .comparison-header {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 20px;
          text-align: center;
        }

        .comparison-title {
          font-family: var(--font-display, inherit);
          font-weight: 700;
          font-size: 1.1rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #f0e6d2;
        }

        .comparison-subtitle {
          font-size: 0.72rem;
          color: #7a7566;
        }

        .comparison-main-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .comparison-main-pcts {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .comparison-main-pct {
          font-family: var(--font-display, inherit);
          font-weight: 700;
          font-size: 1.8rem;
          color: #6b6555;
          transition: color 0.3s ease, text-shadow 0.3s ease;
        }

        .comparison-main-pct.is-favored {
          color: #C8AA6E;
          text-shadow: 0 0 16px rgba(200, 170, 110, 0.4);
        }

        .comparison-main-pct-rival.is-favored {
          color: #4FC3E8;
          text-shadow: 0 0 16px rgba(79, 195, 232, 0.4);
        }

        .comparison-main-vs {
          font-size: 0.65rem;
          font-weight: 700;
          color: #5c5c5c;
        }

        .comparison-main-track {
          height: 12px;
          border-radius: 3px;
          overflow: hidden;
          display: flex;
          border: 1px solid rgba(200, 170, 110, 0.25);
          margin-top: 16px;
        }

        .comparison-main-fill-a {
          height: 100%;
          background: linear-gradient(to right, #C8AA6E, #f0e6d2);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .comparison-main-fill-b {
          height: 100%;
          background: linear-gradient(to right, #93d9f2, #4FC3E8);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .comparison-main-caption {
          margin: 6px 0 0;
          font-size: 0.62rem;
          color: #5c5c5c;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .comparison-breakdown {
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid rgba(200, 170, 110, 0.15);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .comparison-hint {
          margin: 14px 0 0;
          font-size: 0.65rem;
          color: #eab308;
          text-align: center;
        }
      `}</style>
    </div>
  );
}

function FighterMini({ fighter, align }: { fighter: MatchComparisonFighter; align: "left" | "right" }) {
  return (
    <div className={`comparison-fighter ${align === "right" ? "comparison-fighter-right" : ""}`}>
      <img
        src={fighter.photo ?? fallbackPhoto(fighter.name)}
        alt={fighter.name}
        className="comparison-fighter-photo"
      />
      <span className="comparison-fighter-name">{fighter.name}</span>
      <style>{`
        .comparison-fighter {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          min-width: 0;
          flex: 1;
        }

        .comparison-fighter-photo {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid rgba(200, 170, 110, 0.4);
        }

        .comparison-fighter-right .comparison-fighter-photo {
          border-color: rgba(79, 195, 232, 0.4);
        }

        .comparison-fighter-name {
          font-size: 0.75rem;
          font-weight: 700;
          color: white;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100px;
        }
      `}</style>
    </div>
  );
}

function ComparisonRow({ label, aPct, bPct }: { label: string; aPct: number; bPct: number }) {
  return (
    <div className="comparison-row">
      <div className="comparison-row-labels">
        <span className={aPct >= bPct ? "comparison-row-pct-favored-a" : "comparison-row-pct"}>{aPct}%</span>
        <span className="comparison-row-label">{label}</span>
        <span className={bPct > aPct ? "comparison-row-pct-favored-b" : "comparison-row-pct"}>{bPct}%</span>
      </div>
      <div className="comparison-row-track">
        <div className="comparison-row-fill-a" style={{ width: `${aPct}%` }} />
        <div className="comparison-row-fill-b" style={{ width: `${bPct}%` }} />
      </div>
      <style>{`
        .comparison-row-labels {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
        }

        .comparison-row-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #a09b8c;
        }

        .comparison-row-pct,
        .comparison-row-pct-favored-a,
        .comparison-row-pct-favored-b {
          font-size: 0.7rem;
          font-weight: 700;
          color: #6b6555;
          min-width: 2.5ch;
        }

        .comparison-row-pct-favored-a {
          color: #C8AA6E;
        }

        .comparison-row-pct-favored-b {
          color: #4FC3E8;
          text-align: right;
        }

        .comparison-row-pct-favored-b, .comparison-row-pct:last-child {
          text-align: right;
        }

        .comparison-row-track {
          height: 6px;
          border-radius: 2px;
          overflow: hidden;
          display: flex;
          border: 1px solid rgba(200, 170, 110, 0.15);
        }

        .comparison-row-fill-a {
          height: 100%;
          background: linear-gradient(to right, #C8AA6E, #f0e6d2);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .comparison-row-fill-b {
          height: 100%;
          background: linear-gradient(to right, #93d9f2, #4FC3E8);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>
    </div>
  );
}
