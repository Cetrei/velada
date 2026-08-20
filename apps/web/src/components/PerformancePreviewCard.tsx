import type { MmradarPerformanceScores, MmradarTitle } from "@velada/core";
import { resolveTitleColor } from "../lib/mmradarTitleColor";

/**
 * Carta chica que va DEBAJO de la PlayerCard en el aside de vista previa
 * de /mi-perfil (ParticipantProfileForm): muestra las 6 barras de
 * performance de mmradar + un total, calculadas en vivo a partir del
 * mismo checkRiotProfile que ya dispara el check verde/amarillo/rojo del
 * campo Riot ID -- no hace ninguna consulta propia. Es la version
 * "todavia no guardado" de lo que MmradarPanel muestra en la ficha
 * publica ya guardada (/peleadores/[id]): mismo patron visual (icono con
 * nivel superpuesto, Riot ID, tags de titulos con color real/hash,
 * barras de performance), pero sin el boton actualizar, porque ese solo
 * tiene sentido una vez que el perfil ya existe guardado.
 *
 * Icono/riotId/nivel/tags llegan como props nuevos (antes esta carta solo
 * mostraba las 6 barras + rango, quedando "pelada" comparada con
 * MmradarPanel) -- se pasan desde ParticipantProfileForm usando la misma
 * respuesta de checkRiotProfile que ya alimenta scores/performanceRank,
 * asi que no dispara ninguna consulta adicional.
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
  /** Riot ID tal como lo escribio el jugador (ej. "Nombre#TAG"). Opcional: sin esto, la fila de identidad no se dibuja. */
  riotId?: string | null;
  /** URL del icono de invocador (mismo dato que MmradarIconUrl en el perfil ya guardado). */
  iconUrl?: string | null;
  /** Nivel de invocador, se dibuja superpuesto sobre el icono igual que en MmradarPanel. */
  level?: number | null;
  /** Titulos otorgados por mmradar, con color real si vino de la fuente (ver MmradarTitle). */
  titles?: MmradarTitle[] | null;
}

export default function PerformancePreviewCard({
  scores,
  performanceRank,
  status = "idle",
  riotId,
  iconUrl,
  level,
  titles
}: PerformancePreviewCardProps) {
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

  const hasIdentity = Boolean(riotId || iconUrl || (titles && titles.length > 0));

  return (
    <div className="performance-preview-card">
      {titles && titles.length > 0 && (
        <div className="performance-preview-titles">
          {titles.map((title) => {
            const color = resolveTitleColor(title);
            return (
              <span
                key={title.text}
                className="performance-preview-title-chip"
                style={{ color: color.text, background: color.bg, borderColor: color.border }}
              >
                {title.text}
              </span>
            );
          })}
        </div>
      )}

      {hasIdentity && (
        <div className="performance-preview-identity">
          {iconUrl && (
            <span className="performance-preview-icon-wrap">
              <img
                src={iconUrl}
                alt=""
                className="performance-preview-icon"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              {level !== null && level !== undefined && (
                <span className="performance-preview-level">{level}</span>
              )}
            </span>
          )}
          {riotId && <p className="performance-preview-riot-id">{riotId}</p>}
        </div>
      )}

      {/* Bloque de performance con apariencia de "carta": mismo criterio
          visual que MmradarPanel (rectangulo propio, rango de performance
          a la derecha del label, numero total a la derecha de la barra).
          El rango que se muestra es performanceRank (el rango que
          corresponde al desempeno segun mmradar), nunca el rango oficial
          de Riot -- son conceptos distintos, ver mmradarScraper.ts. */}
      <div className="performance-preview-block">
        <div className="performance-preview-header">
          <span className="performance-preview-title">Performance</span>
          <span className={`performance-preview-total ${!hasScores ? "performance-preview-total-empty" : ""}`}>
            {hasScores ? (performanceRank ?? null) : statusText}
          </span>
        </div>
        {hasScores && (
          <div className="performance-preview-average-row">
            <div className="performance-preview-average-track">
              <div className="performance-preview-average-fill" style={{ width: `${Math.min(100, Math.round((total / maxScore) * 100))}%` }} />
            </div>
            <span className="performance-preview-average-value">{total}</span>
          </div>
        )}
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

        .performance-preview-titles {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 10px;
        }

        .performance-preview-title-chip {
          font-size: 0.6rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          background: rgba(79, 195, 232, 0.08);
          border: 1px solid rgba(79, 195, 232, 0.3);
          padding: 2px 7px;
          border-radius: 3px;
        }

        .performance-preview-identity {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }

        .performance-preview-icon-wrap {
          position: relative;
          flex-shrink: 0;
          display: inline-flex;
        }

        .performance-preview-icon {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid #C8AA6E;
          background-color: #0A1428;
        }

        .performance-preview-level {
          position: absolute;
          bottom: -4px;
          left: 50%;
          transform: translateX(-50%);
          background: #0A1428;
          border: 1px solid #C8AA6E;
          color: #C8AA6E;
          font-size: 0.52rem;
          font-weight: 700;
          line-height: 1;
          padding: 1px 4px;
          border-radius: 999px;
          white-space: nowrap;
        }

        .performance-preview-riot-id {
          margin: 0;
          font-size: 0.68rem;
          color: #4FC3E8;
          font-style: italic;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Rectangulo propio que envuelve label + rango + barra, mismo
           criterio visual que .mmradar-performance en MmradarPanel. */
        .performance-preview-block {
          margin-bottom: 10px;
          padding: 8px 10px;
          background: rgba(200, 170, 110, 0.08);
          border: 1px solid rgba(200, 170, 110, 0.25);
          border-radius: 3px;
        }

        .performance-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .performance-preview-average-row {
          margin-top: 6px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .performance-preview-average-track {
          flex: 1;
          height: 8px;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid #C8AA6E;
          border-radius: 2px;
          overflow: hidden;
          box-shadow: 0 0 8px rgba(200, 170, 110, 0.25);
        }

        .performance-preview-average-fill {
          height: 100%;
          background: linear-gradient(to right, #C8AA6E, #f0e6d2, #4FC3E8);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .performance-preview-average-value {
          flex-shrink: 0;
          min-width: 2ch;
          text-align: right;
          font-size: 0.72rem;
          font-weight: 700;
          color: #C8AA6E;
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
