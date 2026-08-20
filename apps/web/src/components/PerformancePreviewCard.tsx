import type { MmradarPerformanceScores } from "@velada/core";

/**
 * Carta chica que va DEBAJO de la PlayerCard en el aside de vista previa
 * de /mi-perfil (ParticipantProfileForm): muestra las 6 barras de
 * performance de mmradar + un total, calculadas en vivo a partir del
 * mismo checkRiotProfile que ya dispara el check verde/amarillo/rojo del
 * campo Riot ID -- no hace ninguna consulta propia. Es la version
 * "todavia no guardado" de lo que MmradarPanel muestra en la ficha
 * publica ya guardada (/peleadores/[id]): mismo patron visual de barras,
 * pero sin icono/server/titulos/boton actualizar, porque esos datos
 * recien existen en participants despues del primer submit.
 */

const STAT_LABELS: Record<keyof MmradarPerformanceScores, string> = {
  laning: "Laning",
  farming: "Farming",
  objectives: "Objectives",
  combat: "Combat",
  teamfight: "Teamfight",
  vision: "Vision"
};

interface PerformancePreviewCardProps {
  scores: MmradarPerformanceScores | null;
  performanceRank?: string | null;
}

export default function PerformancePreviewCard({ scores, performanceRank }: PerformancePreviewCardProps) {
  if (!scores) return null;

  const values = Object.values(scores);
  const maxScore = Math.max(...values, 1);
  const total = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);

  return (
    <div className="performance-preview-card">
      <div className="performance-preview-header">
        <span className="performance-preview-title">Performance</span>
        <span className="performance-preview-total">
          {performanceRank ? performanceRank : `${total}`}
        </span>
      </div>

      <div className="performance-preview-scores">
        {(Object.keys(STAT_LABELS) as (keyof MmradarPerformanceScores)[]).map((key) => (
          <div key={key} className="performance-preview-row">
            <div className="performance-preview-label">
              <span>{STAT_LABELS[key]}</span>
              <span>{scores[key]}</span>
            </div>
            <div className="performance-preview-track">
              <div className="performance-preview-fill" style={{ width: `${(scores[key] / maxScore) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .performance-preview-card {
          margin-top: 12px;
          background: #0A1428;
          border: 1px solid rgba(200, 170, 110, 0.25);
          padding: 14px;
        }

        .performance-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        .performance-preview-title {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #a09b8c;
        }

        .performance-preview-total {
          font-size: 0.78rem;
          font-weight: 700;
          color: #C8AA6E;
        }

        .performance-preview-scores {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .performance-preview-label {
          display: flex;
          justify-content: space-between;
          font-size: 0.62rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #a09b8c;
          margin-bottom: 3px;
        }

        .performance-preview-track {
          height: 5px;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(200, 170, 110, 0.2);
          border-radius: 2px;
          overflow: hidden;
        }

        .performance-preview-fill {
          height: 100%;
          background: linear-gradient(to right, #4FC3E8, #C8AA6E);
        }
      `}</style>
    </div>
  );
}
