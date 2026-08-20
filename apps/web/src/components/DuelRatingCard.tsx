import { DUEL_RATING_EXPLANATION, computeDuelWinProbability, type DuelInput } from "@velada/core";
import InfoModal from "./InfoModal";

/**
 * Bloque de habilidad 1v1 propia (ver packages/core/duelRating.ts):
 * puntaje 0-100 + probabilidad de victoria contra un rival, si se pasa
 * uno (ej. el rival ya asignado en la ruleta, ver peleadores/[id].astro).
 * Se ubica debajo de MmradarPerformanceCard en la ficha publica y en el
 * preview de /mi-perfil -- mismo patron de "no fetch, no estado propio",
 * quien lo monta decide de donde salen los datos.
 */

export interface DuelRatingCardProps {
  /** Rating 0-100 ya cacheado (o null si no hubo partidas suficientes). */
  duelRating?: number | null;
  duelConfidence?: number | null;
  /** Nombre a mostrar para este peleador en la comparacion contra el rival. */
  name?: string | null;
  /** Rival ya asignado (ver `rival` en peleadores/[id].astro) -- opcional, sin rival solo se muestra el rating propio. */
  rival?: {
    name: string;
    duelRating?: number | null;
    lolRank?: string | null;
  } | null;
  /** Fallback por lolRank cuando este peleador todavia no tiene duelRating calculado (ver computeDuelWinProbability). */
  lolRank?: string | null;
  size?: "full" | "compact";
}

const LOW_CONFIDENCE_THRESHOLD = 0.5;

export default function DuelRatingCard({
  duelRating,
  duelConfidence,
  name,
  rival,
  lolRank,
  size = "full"
}: DuelRatingCardProps) {
  if (duelRating === null || duelRating === undefined) return null;

  const compact = size === "compact";
  const lowConfidence = duelConfidence !== null && duelConfidence !== undefined && duelConfidence < LOW_CONFIDENCE_THRESHOLD;

  let probability: { selfPct: number; rivalPct: number } | null = null;
  if (rival) {
    const selfInput: DuelInput = { duelRating, lolRank };
    const rivalInput: DuelInput = { duelRating: rival.duelRating, lolRank: rival.lolRank };
    const result = computeDuelWinProbability(selfInput, rivalInput);
    probability = { selfPct: result.playerAWinPct, rivalPct: result.playerBWinPct };
  }

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

      {rival && probability && (
        <div className="duel-vs">
          <div className="duel-vs-row">
            <div className="duel-vs-side">
              <p className="duel-vs-name">{name ?? "Vos"}</p>
              <p className="duel-vs-pct duel-vs-pct-self">{probability.selfPct}%</p>
            </div>
            <span className="duel-vs-label">VS</span>
            <div className="duel-vs-side duel-vs-side-right">
              <p className="duel-vs-name">{rival.name}</p>
              <p className="duel-vs-pct duel-vs-pct-rival">{probability.rivalPct}%</p>
            </div>
          </div>
          <div className="duel-vs-track">
            <div className="duel-vs-fill-self" style={{ width: `${probability.selfPct}%` }} />
            <div className="duel-vs-fill-rival" style={{ width: `${probability.rivalPct}%` }} />
          </div>
          <p className="duel-vs-caption">Probabilidad estimada de ganar un 1v1 directo</p>
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

        .duel-vs {
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid rgba(200, 170, 110, 0.15);
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
