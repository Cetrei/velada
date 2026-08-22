import { DUEL_RATING_EXPLANATION, computeDuelWinProbability, type DuelInput } from "@velada/core";
import InfoModal from "./InfoModal";

export interface DuelRatingCardRival {
  name: string;
  duelRating?: number | null;
  lolRank?: string | null;
  /** Id del combate 1v1 contra este rival, para linkear a /combates/[id] -- ver peleadores/[id].astro. Sin id la fila no es clickeable. */
  matchId?: string | null;
}

export interface DuelRatingCardProps {
  /** Rating 0-100 ya cacheado (o null si no hubo partidas suficientes). */
  duelRating?: number | null;
  duelConfidence?: number | null;
  /** Nombre a mostrar para este peleador en la comparacion contra el/los rival(es). */
  name?: string | null;
  /**
   * Rivales ya asignados (ver `rivals` en peleadores/[id].astro) -- un
   * peleador puede tener varios 1v1 (pedido del usuario 2026-08-21: "cada
   * jugador puede tener varios 1 vs 1"), asi que esto es un array, no un
   * rival unico. Sin rivales solo se muestra el rating propio. Cada fila
   * es clickeable hacia /combates/[id] si trae matchId, mismo patron que
   * MatchResultCard.astro.
   */
  rivals?: DuelRatingCardRival[] | null;
  /** Fallback por lolRank cuando este peleador todavia no tiene duelRating calculado (ver computeDuelWinProbability). */
  lolRank?: string | null;
  size?: "full" | "compact";
}

const LOW_CONFIDENCE_THRESHOLD = 0.5;

export default function DuelRatingCard({
  duelRating,
  duelConfidence,
  name,
  rivals,
  lolRank,
  size = "full"
}: DuelRatingCardProps) {
  if (duelRating === null || duelRating === undefined) return null;

  const compact = size === "compact";
  const lowConfidence = duelConfidence !== null && duelConfidence !== undefined && duelConfidence < LOW_CONFIDENCE_THRESHOLD;

  const selfInput: DuelInput = { duelRating, lolRank };
  const matchups = (rivals ?? []).map((rival) => {
    const rivalInput: DuelInput = { duelRating: rival.duelRating, lolRank: rival.lolRank };
    const result = computeDuelWinProbability(selfInput, rivalInput);
    return { rival, selfPct: result.playerAWinPct, rivalPct: result.playerBWinPct };
  });

  return (
    <div className={`duel-card ${compact ? "duel-card-compact" : ""}`}>
      <div className="duel-header">
        <span className="duel-label-with-info">
          <span className="duel-label">Habilidad 1v1</span>
          <InfoModal label={DUEL_RATING_EXPLANATION.title} title={DUEL_RATING_EXPLANATION.title}>
            <p>{DUEL_RATING_EXPLANATION.summary}</p>
            <p className="info-modal-formula">{DUEL_RATING_EXPLANATION.formula}</p>
            <ul>
              {DUEL_RATING_EXPLANATION.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p>{DUEL_RATING_EXPLANATION.probabilityFormula}</p>
          </InfoModal>
        </span>
        <span className="duel-rating-value">{duelRating}</span>
      </div>

      <div className="duel-rating-track">
        <div className="duel-rating-fill" style={{ width: `${duelRating}%` }} />
      </div>

      {lowConfidence && <p className="duel-low-confidence">Basado en pocas partidas -- el número puede cambiar.</p>}

      {matchups.length > 0 && (
        <div className="duel-vs-list">
          {matchups.map(({ rival, selfPct, rivalPct }, i) => {
            const href = rival.matchId ? `/combates/${rival.matchId}` : null;
            const Wrapper = href ? "a" : "div";
            return (
              <Wrapper
                key={rival.matchId ?? `${rival.name}-${i}`}
                {...(href ? { href } : {})}
                className={`duel-vs ${href ? "duel-vs-clickable" : ""}`}
              >
                <div className="duel-vs-row">
                  <div className="duel-vs-side">
                    <p className="duel-vs-name">{name ?? "Vos"}</p>
                    <p className="duel-vs-pct duel-vs-pct-self">{selfPct}%</p>
                  </div>
                  <span className="duel-vs-label">VS</span>
                  <div className="duel-vs-side duel-vs-side-right">
                    <p className="duel-vs-name">{rival.name}</p>
                    <p className="duel-vs-pct duel-vs-pct-rival">{rivalPct}%</p>
                  </div>
                </div>
                <div className="duel-vs-track">
                  <div className="duel-vs-fill-self" style={{ width: `${selfPct}%` }} />
                  <div className="duel-vs-fill-rival" style={{ width: `${rivalPct}%` }} />
                </div>
                <p className="duel-vs-caption">
                  {href ? "Ver combate -- probabilidad estimada de ganar" : "Probabilidad estimada de ganar un 1v1 directo"}
                </p>
              </Wrapper>
            );
          })}
        </div>
      )}

      <style>{`
        .duel-card {
          background: var(--lol-card-bg, #0A1428);
          border: 1px solid rgba(200, 170, 110, 0.25);
          padding: 20px;
          margin-top: 12px;
        }

        .duel-card-compact {
          padding: 14px;
          margin-top: 10px;
        }

        .duel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 8px;
        }

        .duel-label-with-info {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .duel-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #a09b8c;
        }

        .duel-card-compact .duel-label {
          font-size: 0.7rem;
        }

        .duel-rating-value {
          font-size: 1.1rem;
          font-weight: 700;
          color: #ef4444;
        }

        .duel-card-compact .duel-rating-value {
          font-size: 0.85rem;
        }

        .duel-rating-track {
          height: 10px;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(239, 68, 68, 0.4);
          border-radius: 3px;
          overflow: hidden;
          box-shadow: 0 0 10px rgba(239, 68, 68, 0.2);
        }

        .duel-card-compact .duel-rating-track {
          height: 7px;
        }

        .duel-rating-fill {
          height: 100%;
          background: linear-gradient(to right, #C8AA6E, #ef4444);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .duel-low-confidence {
          margin: 8px 0 0;
          font-size: 0.65rem;
          color: #eab308;
        }

        .duel-vs-list {
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid rgba(200, 170, 110, 0.15);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .duel-vs {
          display: block;
          text-decoration: none;
          border-radius: 4px;
        }

        .duel-vs-list .duel-vs + .duel-vs {
          padding-top: 10px;
          border-top: 1px dashed rgba(200, 170, 110, 0.12);
        }

        .duel-vs-clickable {
          margin: -6px;
          padding: 6px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
        }

        .duel-vs-clickable:hover {
          background: rgba(200, 170, 110, 0.06);
          border-color: rgba(200, 170, 110, 0.3);
          transform: translateX(2px);
        }

        @media (prefers-reduced-motion: reduce) {
          .duel-vs-clickable:hover {
            transform: none;
          }
        }

        .duel-vs-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 8px;
        }

        .duel-vs-side {
          flex: 1;
          min-width: 0;
        }

        .duel-vs-side-right {
          text-align: right;
        }

        .duel-vs-name {
          margin: 0;
          font-size: 0.72rem;
          font-weight: 700;
          color: white;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .duel-vs-pct {
          margin: 2px 0 0;
          font-size: 1.3rem;
          font-weight: 700;
          font-family: var(--font-display, inherit);
        }

        .duel-vs-pct-self {
          color: #C8AA6E;
        }

        .duel-vs-pct-rival {
          color: #4FC3E8;
        }

        .duel-vs-label {
          flex-shrink: 0;
          font-size: 0.7rem;
          font-weight: 700;
          color: #a09b8c;
        }

        .duel-vs-track {
          height: 8px;
          border-radius: 3px;
          overflow: hidden;
          display: flex;
          border: 1px solid rgba(200, 170, 110, 0.25);
        }

        .duel-vs-fill-self {
          height: 100%;
          background: linear-gradient(to right, #C8AA6E, #f0e6d2);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .duel-vs-fill-rival {
          height: 100%;
          background: linear-gradient(to right, #93d9f2, #4FC3E8);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .duel-vs-caption {
          margin: 6px 0 0;
          font-size: 0.6rem;
          color: #5c5c5c;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
      `}</style>
    </div>
  );
}
