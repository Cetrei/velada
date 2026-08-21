import type { MmradarPerformanceScores, MmradarTitle } from "@velada/core";
import { MMRADAR_SCORES_EXPLAINED, PERFORMANCE_RANK_EXPLANATION } from "@velada/core";
import { resolveTitleColor } from "../lib/mmradarTitleColor";
import InfoModal from "./InfoModal";

/**
 * Presentacion unica del bloque de mmradar (icono+nivel, Riot ID, titulos,
 * bloque Performance con rango+barra promedio, 6 barras). Usado por
 * MmradarPanel (ficha guardada, /peleadores/[id]) y por el preview de
 * /mi-perfil. No hace fetch ni tiene estado propio; quien lo monta decide
 * de donde salen los datos y si pasa headerAction (boton "Actualizar").
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

/**
 * Maximo de RENDER fijo para las barras (6 individuales + la de
 * Performance) -- pedido explicito del usuario 2026-08-20: mmradar usa
 * 2500 como techo visual de sus propias barras, aunque un valor real
 * puntual pueda superarlo (se clampea al 100% en ese caso, no se
 * reescala el resto de las barras). Reemplaza el Math.max(...values, 1)
 * dinamico que habia antes, que hacia que la barra mas alta de cada
 * jugador SIEMPRE se viera al 100% sin importar su valor real -- con eso
 * dos perfiles con stats muy distintos (ej. 1200 vs 2400 de Combat)
 * podian verse con barras igual de "llenas", perdiendo toda comparacion
 * visual entre perfiles.
 */
const BAR_RENDER_MAX = 2500;

function barPct(value: number): number {
  return Math.min(100, Math.round((value / BAR_RENDER_MAX) * 100));
}

/**
 * Texto corto tipo "hace 5 min" / "hace 3 h" / "hace 2 dias" para mostrar
 * junto al boton "Actualizar" (pedido del usuario 2026-08-20, para que se
 * note si alguien lo uso hace poco). Cae a fecha corta (dd/mm) pasada una
 * semana, donde un relativo ya no aporta nada util.
 */
function formatRelativeUpdatedAt(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "hace instantes";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} ${days === 1 ? "dia" : "dias"}`;
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "2-digit" });
}

export type MmradarCardStatus = "idle" | "checking" | "found" | "not_found" | "invalid" | "error";

export interface MmradarPerformanceCardProps {
  titles?: MmradarTitle[] | null;
  riotId?: string | null;
  iconUrl?: string | null;
  level?: number | null;
  /** Solo se usa en modo "full" (ficha guardada). */
  server?: string | null;
  performanceRank?: string | null;
  scores?: MmradarPerformanceScores | null;
  /** "idle" para ficha guardada. El resto es para el preview en vivo de /mi-perfil. */
  status?: MmradarCardStatus;
  /** Boton "Actualizar" u otra accion, solo relevante en ficha guardada con permiso. */
  headerAction?: React.ReactNode;
  statusMessage?: { type: "success" | "error"; text: string } | null;
  /** "full" = ficha publica, "compact" = preview lateral de /mi-perfil. */
  size?: "full" | "compact";
  /** Ultima vez que se recalcularon estos datos (ISO). Solo se muestra en modo "full". */
  updatedAt?: string | null;
}

export default function MmradarPerformanceCard({
  titles,
  riotId,
  iconUrl,
  level,
  server,
  performanceRank,
  scores,
  status = "idle",
  headerAction,
  statusMessage,
  size = "full",
  updatedAt
}: MmradarPerformanceCardProps) {
  const hasScores = Boolean(scores);
  const displayScores = scores ?? EMPTY_SCORES;
  const values = Object.values(displayScores);
  const average = hasScores ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;
  const averagePct = average !== null ? barPct(average) : 0;

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
  const hasAnyContent = hasIdentity || hasScores || Boolean(performanceRank) || Boolean(headerAction);
  if (!hasAnyContent) return null;

  const compact = size === "compact";
  const iconSize = compact ? 34 : 48;

  return (
    <div className={`mmradar-card ${compact ? "mmradar-card-compact" : ""}`}>
      {titles && titles.length > 0 && (
        <div className="mmradar-titles">
          {titles.map((title) => {
            const color = resolveTitleColor(title);
            return (
              <span
                key={title.text}
                className="mmradar-title-chip"
                style={{ color: color.text, background: color.bg, borderColor: color.border }}
                title={title.reason ?? undefined}
              >
                {title.text}
              </span>
            );
          })}
        </div>
      )}

      {(hasIdentity || headerAction) && (
        <div className="mmradar-header">
          <div className="mmradar-identity">
            {iconUrl && (
              <span className="mmradar-icon-wrap" style={{ width: iconSize, height: iconSize }}>
                <img
                  src={iconUrl}
                  alt=""
                  className="mmradar-icon"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                {level !== null && level !== undefined && <span className="mmradar-level">{level}</span>}
              </span>
            )}
            <div className="mmradar-identity-text">
              {riotId && <p className="mmradar-riot-id">{riotId}</p>}
              {server && (
                <div className="mmradar-meta">
                  <span className="mmradar-server">{server}</span>
                </div>
              )}
            </div>
          </div>

          <div className="mmradar-header-action-col">
            {headerAction}
            {!compact && updatedAt && (
              <span className="mmradar-updated-at">Actualizado {formatRelativeUpdatedAt(updatedAt)}</span>
            )}
          </div>
        </div>
      )}

      {statusMessage && <p className={`mmradar-status mmradar-status-${statusMessage.type}`}>{statusMessage.text}</p>}

      {/* Rango de performance, nunca lolRank (rango oficial de Riot). */}
      {(hasScores || performanceRank || statusText) && (
        <div className="mmradar-performance">
          <div className="mmradar-performance-label-row">
            <span className="mmradar-performance-label-with-info">
              <span className="mmradar-performance-label">Performance</span>
              <InfoModal label={PERFORMANCE_RANK_EXPLANATION.title} title={PERFORMANCE_RANK_EXPLANATION.title}>
                <p>{PERFORMANCE_RANK_EXPLANATION.summary}</p>
                <p className="info-modal-formula">{PERFORMANCE_RANK_EXPLANATION.formula}</p>
                <ul>
                  {PERFORMANCE_RANK_EXPLANATION.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </InfoModal>
            </span>
            <span className={`mmradar-performance-rank ${!hasScores && statusText ? "mmradar-performance-rank-empty" : ""}`}>
              {hasScores ? performanceRank ?? null : statusText}
            </span>
          </div>
          {hasScores && average !== null && (
            <div className="mmradar-average-row">
              <div className="mmradar-average-track">
                <div className="mmradar-average-fill" style={{ width: `${averagePct}%` }} />
              </div>
              <span className="mmradar-average-value">{average}</span>
            </div>
          )}
        </div>
      )}

      <div className={`mmradar-scores ${status === "checking" ? "mmradar-scores-pulsing" : ""}`}>
        <div className="mmradar-scores-header">
          <span className="mmradar-scores-header-label">Desglose</span>
          <InfoModal label={MMRADAR_SCORES_EXPLAINED.title} title={MMRADAR_SCORES_EXPLAINED.title} iconSize={13}>
            <p>{MMRADAR_SCORES_EXPLAINED.summary}</p>
            <div className="mmradar-ranges">
              {MMRADAR_SCORES_EXPLAINED.ranges.map((range) => (
                <span key={range.label} className="mmradar-range-chip">
                  {range.max === null ? `${range.min}+` : `${range.min}-${range.max}`}
                  <em>{range.label}</em>
                </span>
              ))}
            </div>
            <ul className="mmradar-stats-glossary">
              {(Object.keys(STAT_LABELS) as (keyof MmradarPerformanceScores)[]).map((key) => (
                <li key={key}>
                  <strong>{MMRADAR_SCORES_EXPLAINED.stats[key].label}:</strong>{" "}
                  {MMRADAR_SCORES_EXPLAINED.stats[key].description}
                </li>
              ))}
            </ul>
          </InfoModal>
        </div>
        {(Object.keys(STAT_LABELS) as (keyof MmradarPerformanceScores)[]).map((key) => (
          <div key={key} className="mmradar-score-row">
            <div className="mmradar-score-label">
              <span>{STAT_LABELS[key]}</span>
              <span>{hasScores ? displayScores[key] : "--"}</span>
            </div>
            <div className="mmradar-score-track">
              <div
                className="mmradar-score-fill"
                style={{ width: hasScores ? `${barPct(displayScores[key])}%` : "0%" }}
              />
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .mmradar-card {
          background: var(--lol-card-bg, #0A1428);
          border: 1px solid rgba(200, 170, 110, 0.25);
          padding: 20px;
        }

        .mmradar-card-compact {
          margin-top: 12px;
          padding: 14px;
        }

        .mmradar-titles {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 10px;
        }

        .mmradar-card-compact .mmradar-titles {
          gap: 6px;
        }

        .mmradar-title-chip {
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          background: rgba(79, 195, 232, 0.08);
          border: 1px solid rgba(79, 195, 232, 0.3);
          padding: 3px 8px;
          border-radius: 3px;
          white-space: nowrap;
          cursor: help;
        }

        .mmradar-card-compact .mmradar-title-chip {
          font-size: 0.6rem;
          padding: 2px 7px;
        }

        .mmradar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }

        .mmradar-identity {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .mmradar-card-compact .mmradar-identity {
          gap: 10px;
        }

        .mmradar-icon-wrap {
          position: relative;
          flex-shrink: 0;
          display: inline-flex;
        }

        .mmradar-icon {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid #C8AA6E;
          background-color: #0A1428;
        }

        .mmradar-level {
          position: absolute;
          bottom: -4px;
          left: 50%;
          transform: translateX(-50%);
          background: #0A1428;
          border: 1px solid #C8AA6E;
          color: #C8AA6E;
          font-size: 0.6rem;
          font-weight: 700;
          line-height: 1;
          padding: 2px 5px;
          border-radius: 999px;
          white-space: nowrap;
        }

        .mmradar-card-compact .mmradar-level {
          font-size: 0.52rem;
          padding: 1px 4px;
        }

        .mmradar-identity-text {
          min-width: 0;
        }

        .mmradar-riot-id {
          margin: 0;
          font-size: 0.85rem;
          font-weight: 700;
          color: #4FC3E8;
          font-style: italic;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .mmradar-card-compact .mmradar-riot-id {
          font-size: 0.68rem;
          font-weight: 400;
        }

        .mmradar-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 4px;
        }

        .mmradar-server {
          font-size: 0.65rem;
          font-weight: 700;
          color: #a09b8c;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border: 1px solid rgba(200, 170, 110, 0.3);
          border-radius: 3px;
          padding: 1px 6px;
        }

        .mmradar-status {
          margin: 0 0 10px;
          font-size: 0.72rem;
        }

        .mmradar-status-success {
          color: #49B16F;
        }

        .mmradar-status-error {
          color: #e35d5d;
        }

        .mmradar-header-action-col {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
          flex-shrink: 0;
        }

        .mmradar-updated-at {
          font-size: 0.62rem;
          color: #7a7566;
          white-space: nowrap;
        }

        .mmradar-update-btn {
          flex-shrink: 0;
          background: rgba(200, 170, 110, 0.1);
          border: 1px solid #C8AA6E;
          color: #C8AA6E;
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 6px 14px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .mmradar-update-btn:hover:not(:disabled) {
          background: #C8AA6E;
          color: #0A1428;
        }

        .mmradar-update-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .mmradar-performance {
          padding: 10px 12px;
          background: rgba(200, 170, 110, 0.08);
          border: 1px solid rgba(200, 170, 110, 0.25);
          border-radius: 3px;
          margin-bottom: 10px;
        }

        .mmradar-card-compact .mmradar-performance {
          padding: 8px 10px;
        }

        .mmradar-performance-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .mmradar-performance-label-with-info {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .mmradar-performance-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #a09b8c;
        }

        .mmradar-card-compact .mmradar-performance-label {
          font-size: 0.7rem;
        }

        .mmradar-performance-rank {
          font-size: 0.78rem;
          font-weight: 700;
          color: #C8AA6E;
          transition: color 0.3s ease;
        }

        .mmradar-performance-rank-empty {
          font-size: 0.62rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #5c5c5c;
        }

        .mmradar-average-row {
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .mmradar-average-track {
          flex: 1;
          height: 12px;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid #C8AA6E;
          border-radius: 3px;
          overflow: hidden;
          box-shadow: 0 0 10px rgba(200, 170, 110, 0.25);
        }

        .mmradar-card-compact .mmradar-average-track {
          height: 8px;
          border-radius: 2px;
          box-shadow: 0 0 8px rgba(200, 170, 110, 0.25);
        }

        .mmradar-average-fill {
          height: 100%;
          background: linear-gradient(to right, #C8AA6E, #f0e6d2, #4FC3E8);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .mmradar-average-value {
          flex-shrink: 0;
          min-width: 2ch;
          text-align: right;
          font-size: 0.95rem;
          font-weight: 700;
          color: #C8AA6E;
        }

        .mmradar-card-compact .mmradar-average-value {
          font-size: 0.72rem;
        }

        .mmradar-scores {
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: opacity 0.3s ease;
        }

        .mmradar-scores-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 2px;
        }

        .mmradar-scores-header-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #a09b8c;
        }

        .mmradar-card-compact .mmradar-scores-header-label {
          font-size: 0.62rem;
        }

        .mmradar-ranges {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin: 0 0 12px;
        }

        .mmradar-range-chip {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          flex: 1 1 auto;
          min-width: 68px;
          padding: 6px 8px;
          text-align: center;
          font-size: 0.68rem;
          font-weight: 700;
          color: #f0e6d2;
          background: rgba(79, 195, 232, 0.08);
          border: 1px solid rgba(200, 170, 110, 0.3);
          border-radius: 4px;
        }

        .mmradar-range-chip em {
          font-style: normal;
          font-size: 0.6rem;
          font-weight: 600;
          color: #a09b8c;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        .mmradar-stats-glossary {
          margin: 0;
          padding-left: 18px;
        }

        .mmradar-stats-glossary li {
          margin-bottom: 8px;
        }

        .mmradar-stats-glossary li:last-child {
          margin-bottom: 0;
        }

        .mmradar-stats-glossary strong {
          color: #C8AA6E;
        }

        .mmradar-card-compact .mmradar-scores {
          gap: 7px;
        }

        .mmradar-scores-pulsing {
          animation: mmradarScoresPulse 1.4s ease-in-out infinite;
        }

        @keyframes mmradarScoresPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }

        .mmradar-score-label {
          display: flex;
          justify-content: space-between;
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #a09b8c;
          margin-bottom: 3px;
        }

        .mmradar-card-compact .mmradar-score-label {
          font-size: 0.62rem;
        }

        .mmradar-score-track {
          height: 5px;
          background: rgba(0, 0, 0, 0.5);
          border: 1px solid rgba(200, 170, 110, 0.2);
          border-radius: 2px;
          overflow: hidden;
        }

        .mmradar-score-fill {
          height: 100%;
          background: linear-gradient(to right, #4FC3E8, #C8AA6E);
          transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>
    </div>
  );
}
