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
 *
 * A diferencia de la version anterior, esta carta SIEMPRE se monta (ya
 * no hace "if (!scores) return null") -- antes, un peleador sin
 * performanceScores guardado (perfil nunca actualizado desde que existe
 * esta feature, o cuyo ultimo submit no encontro nada en mmradar) nunca
 * veia la carta en absoluto, lo cual parecia un bug de "no cargo" en vez
 * de "todavia no hay dato". Ahora, sin scores, se dibuja el mismo layout
 * con las barras en 0 y una etiqueta de estado (loading/idle/error) en
 * vez de desaparecer -- asi la carta "siempre sale", y cuando
 * ParticipantProfileForm dispara el auto-check de Riot ID al montar (ver
 * ese archivo), las barras pasan de 0 a su valor real con una transicion
 * CSS en width/opacity en vez de aparecer de golpe.
 */

const STAT_LABELS: Record<keyof MmradarPerformanceScores, string> = {
  laning: "Laning",
  farming: "Farming",
  objectives: "Objectives",
  combat: "Combat",
  teamfight: "Teamfight",
  vision: "Vision"
};

const EMPTY_SCORES: MmradarPerformanceScores = {
  laning: 0,
  farming: 0,
  objectives: 0,
  combat: 0,
  teamfight: 0,
  vision: 0
};

interface PerformancePreviewCardProps {
  scores: MmradarPerformanceScores | null;
  performanceRank?: string | null;
  /**
   * Refleja el estado del check de Riot en el padre (idle/checking/found/
   * not_found/invalid/error) para que la carta pueda distinguir "todavia
   * no hay dato porque no se cargo ningun Riot ID" de "se esta buscando
   * ahora mismo" de "no se encontro nada" -- las barras en 0 se ven
   * iguales en los tres casos, pero el texto de estado cambia.
   */
  status?: "idle" | "checking" | "found" | "not_found" | "invalid" | "error";
}

export default function PerformancePreviewCard({ scores, performanceRank, status = "idle" }: PerformancePreviewCardProps) {
  const hasScores = scores !== null;
  const displayScores = scores ?? EMPTY_SCORES;
  const values = Object.values(displayScores);
  const maxScore = Math.max(...values, 1);
  const total = hasScores ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;

  const statusText =
    status === "checking"
      ? "Calculando..."
      : status === "not_found" || status === "invalid"
        ? "Sin datos"
        : status === "error"
          ? "No disponible"
          : hasScores
            ? null
            : "Sin datos aun";

  return (
    <div className="performance-preview-card">
      <div className="performance-preview-header">
        <span className="performance-preview-title">Performance</span>
        <span className={`performance-preview-total ${!hasScores ? "performance-preview-total-empty" : ""}`}>
          {hasScores ? (performanceRank ? performanceRank : `${total}`) : statusText}
        </span>
      </div>

      <div className={`performance-preview-scores ${status === "checking" ? "performance-preview-pulsing" : ""}`}>
        {(Object.keys(STAT_LABELS) as (keyof MmradarPerformanceScores)[]).map((key) => (
          <div key={key} className="performance-preview-row">
            <div className="performance-preview-label">
              <span>{STAT_LABELS[key]}</span>
              <span>{hasScores ? displayScores[key] : "--"}</span>
            </div>
            <div className="performance-preview-track">
              <div
                className="performance-preview-fill"
                style={{ width: hasScores ? `${(displayScores[key] / maxScore) * 100}%` : "0%" }}
              />
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
          transition: color 0.3s ease;
        }

        .performance-preview-total-empty {
          font-size: 0.62rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #5c5c5c;
        }

        .performance-preview-scores {
          display: flex;
          flex-direction: column;
          gap: 7px;
          transition: opacity 0.3s ease;
        }

        /* Pulso sutil sobre toda la pila de barras mientras el check de
           Riot esta en curso (status === "checking"), asi la carta se ve
           "viva" en vez de simplemente estancada en 0 mientras se espera
           la respuesta del auto-fetch. */
        .performance-preview-pulsing {
          animation: performancePreviewPulse 1.4s ease-in-out infinite;
        }

        @keyframes performancePreviewPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
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
          /* Las barras arrancan en 0% (ver EMPTY_SCORES/hasScores mas arriba)
             y esta transicion es lo que las hace "llenarse" en vivo cuando
             el auto-fetch de Riot en ParticipantProfileForm resuelve y
             hasScores pasa a true -- sin esto, el cambio de width se veria
             instantaneo en vez de una animacion de llenado. */
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>
    </div>
  );
}
