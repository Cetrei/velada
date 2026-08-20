import { useState } from "react";
import { actions } from "astro:actions";
import type { Participant, MmradarPerformanceScores, MmradarTitle } from "@velada/core";
import { emitMmradarUpdate } from "../lib/mmradarUpdateBus";
import { resolveTitleColor } from "../lib/mmradarTitleColor";

type ParticipantMmradarData = Pick<
  Participant,
  | "id"
  | "name"
  | "lolUsername"
  | "performanceRank"
  | "performanceScores"
  | "titles"
  | "mmradarIconUrl"
  | "mmradarServer"
  | "mmradarLevel"
  | "memeTitles"
  | "memeIconUrl"
>;

interface MmradarPanelProps {
  participant: ParticipantMmradarData;
  /** Solo el dueno del perfil o un admin de panel puede forzar una re-consulta. */
  canUpdate: boolean;
  /**
   * Notifica al padre cuando refreshMmradarData trae datos nuevos, para
   * que la PlayerCard de al lado (carta izquierda de /peleadores/[id]) se
   * actualice tambien sin recargar la pagina -- ambas leen la misma fila
   * de participants, pero cada componente tenia su propio estado aislado
   * antes de esto. Opcional: MmradarPanel sigue funcionando solo si nadie
   * lo pasa.
   */
  onUpdated?: (data: { performanceRank: string | null; performanceScores: MmradarPerformanceScores | null }) => void;
}

type StatusMessage = { type: "success" | "error"; text: string } | null;

const STAT_LABELS: Record<keyof MmradarPerformanceScores, string> = {
  laning: "Laning",
  farming: "Farming",
  objectives: "Objectives",
  combat: "Combat",
  teamfight: "Teamfight",
  vision: "Vision"
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default function MmradarPanel({ participant, canUpdate, onUpdated }: MmradarPanelProps) {
  const [scores, setScores] = useState(participant.performanceScores ?? null);
  const [performanceRank, setPerformanceRank] = useState(participant.performanceRank ?? null);
  const [titles, setTitles] = useState(participant.titles ?? null);
  const [iconUrl, setIconUrl] = useState(participant.mmradarIconUrl ?? null);
  const [server, setServer] = useState(participant.mmradarServer ?? null);
  const [level, setLevel] = useState(participant.mmradarLevel ?? null);
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);

  // Fallback de meme: si no hay titulos/icono reales de mmradar (nunca los
  // pisa si existen), se usan memeTitles/memeIconUrl para que un
  // participante de meme (sin lolUsername real) igual muestre algo arriba
  // del nombre en este mismo cuadro -- ver comentario de cabecera del
  // archivo. memeTitles es string[] (no trae color real de ninguna fuente,
  // a diferencia de MmradarTitle), asi que se envuelve a {text, color:
  // null} para reusar el mismo render/resolveTitleColor que los titulos
  // reales (cae al hash determinista por texto, mismo criterio que
  // cualquier titulo sin color).
  const displayTitles: MmradarTitle[] | null =
    titles && titles.length > 0
      ? titles
      : participant.memeTitles && participant.memeTitles.length > 0
        ? participant.memeTitles.map((text) => ({ text, color: null }))
        : null;
  const displayIconUrl = iconUrl ?? participant.memeIconUrl ?? null;

  const hasAnyData = Boolean(
    performanceRank ||
      scores ||
      (displayTitles && displayTitles.length > 0) ||
      displayIconUrl ||
      server ||
      level ||
      participant.lolUsername
  );
  if (!hasAnyData && !canUpdate) return null;

  const maxScore = scores ? Math.max(...Object.values(scores), 1) : 1;
  // El promedio NO es un promedio aritmetico simple de las 6 scores: es el
  // mismo total que ya calcula mmradar.gg del lado del cliente (ver
  // fetchMatchScores en packages/core/mmradarScraper.ts), pensado para no
  // dejar que un solo partido malo tire abajo la lectura general de
  // habilidad -- por eso se resalta aparte de las 6 barras individuales en
  // vez de mezclarse como una mas. Se muestra como una barra propia, mas
  // gruesa, sin la etiqueta de texto (pedido explicito) -- el tamano y el
  // borde dorado son lo que la distingue de las 6 de abajo.
  const averageScore = scores
    ? Math.round(Object.values(scores).reduce((sum, v) => sum + v, 0) / Object.values(scores).length)
    : null;
  const averagePct = averageScore !== null ? Math.min(100, Math.round((averageScore / maxScore) * 100)) : 0;

  async function handleUpdate() {
    setUpdating(true);
    setStatus(null);
    try {
      const formData = new FormData();
      formData.set("id", participant.id);
      const { data, error } = await actions.refreshMmradarData(formData);
      if (error) {
        setStatus({ type: "error", text: errorMessage(error.message ?? error) });
        return;
      }
      if (data) {
        setPerformanceRank(data.performanceRank ?? null);
        setScores(data.performanceScores ?? null);
        setTitles(data.titles ?? null);
        setIconUrl(data.mmradarIconUrl ?? null);
        setServer(data.mmradarServer ?? null);
        setLevel(data.mmradarLevel ?? null);
        setStatus({ type: "success", text: "Datos actualizados." });
        onUpdated?.({ performanceRank: data.performanceRank ?? null, performanceScores: data.performanceScores ?? null });
        // Antes no se mandaba performanceScores aca -- PlayerCardLive
        // escuchaba el evento pero nunca recibia los 6 scores crudos, asi
        // que apretar "Actualizar" movia el texto de performance de la
        // carta de al lado pero nunca su barra (ver PlayerCardLive.tsx).
        emitMmradarUpdate({
          participantId: participant.id,
          performanceRank: data.performanceRank ?? null,
          performanceScores: data.performanceScores ?? null
        });
      }
    } catch (err) {
      setStatus({ type: "error", text: errorMessage(err) });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="mmradar-panel">
      <div className="mmradar-header">
        <div className="mmradar-identity">
          {displayIconUrl && (
            <span className="mmradar-icon-wrap">
              <img
                src={displayIconUrl}
                alt=""
                className="mmradar-icon"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              {level !== null && <span className="mmradar-level">{level}</span>}
            </span>
          )}
          <div className="mmradar-identity-text">
            {/* Antes aca iba participant.name (nombre real del peleador, ya
                visible arriba del todo en peleadores/[id].astro como <h1>) --
                pedido explicito: en este cuadro puntual, donde antes salia el
                nombre, tienen que ir los titulos de mmradar (antes vivian en
                un bloque aparte arriba de todo el panel). Solo el Riot ID se
                queda como identificador de texto en esta fila. */}
            {displayTitles && displayTitles.length > 0 && (
              <div className="mmradar-titles">
                {displayTitles.map((title) => {
                  const color = resolveTitleColor(title);
                  return (
                    <span
                      key={title.text}
                      className="mmradar-title-chip"
                      style={{ color: color.text, background: color.bg, borderColor: color.border }}
                    >
                      {title.text}
                    </span>
                  );
                })}
              </div>
            )}
            {participant.lolUsername && <p className="mmradar-riot-id">{participant.lolUsername}</p>}
            {server && (
              <div className="mmradar-meta">
                <span className="mmradar-server">{server}</span>
              </div>
            )}
          </div>
        </div>

        {canUpdate && (
          <button type="button" className="mmradar-update-btn" onClick={handleUpdate} disabled={updating}>
            {updating ? "Actualizando..." : "Actualizar"}
          </button>
        )}
      </div>

      {status && <p className={`mmradar-status mmradar-status-${status.type}`}>{status.text}</p>}

      {/* Bloque de performance con apariencia de "carta": rectangulo
          propio (mismo criterio visual que el bloque de performance que
          antes vivia en PlayerCard, ver ese componente -- se saco de ahi
          porque quedaba duplicado con este panel) con el rango a la
          derecha del label "Performance" y el numero total a la derecha
          de la barra. El rango que se muestra aca es performanceRank (el
          rango que corresponde al desempeno segun mmradar, ej. "EMERALD
          IV"), nunca lolRank (el rango oficial de Riot/Solo-Duo) -- son
          conceptos distintos y mmradar los separa igual en su propio
          sitio (ver id="performance-rank" vs id="current-rank" en
          mmradarScraper.ts). */}
      {(scores || performanceRank) && (
        <div className="mmradar-performance">
          <div className="mmradar-performance-label-row">
            <span className="mmradar-performance-label">Performance</span>
            {performanceRank && <span className="mmradar-performance-rank">{performanceRank}</span>}
          </div>
          {scores && averageScore !== null && (
            <div className="mmradar-average-row">
              <div className="mmradar-average-track">
                <div className="mmradar-average-fill" style={{ width: `${averagePct}%` }} />
              </div>
              <span className="mmradar-average-value">{averageScore}</span>
            </div>
          )}
        </div>
      )}

      {scores && (
        <div className="mmradar-scores">
          {(Object.keys(STAT_LABELS) as (keyof MmradarPerformanceScores)[]).map((key) => (
            <div key={key} className="mmradar-score-row">
              <div className="mmradar-score-label">
                <span>{STAT_LABELS[key]}</span>
                <span>{scores[key]}</span>
              </div>
              <div className="mmradar-score-track">
                <div className="mmradar-score-fill" style={{ width: `${(scores[key] / maxScore) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .mmradar-panel {
          background: var(--lol-card-bg, #0a1428);
          border: 1px solid rgba(200, 170, 110, 0.25);
          padding: 20px;
        }

        .mmradar-titles {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 4px;
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
        }

        .mmradar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .mmradar-identity {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .mmradar-icon-wrap {
          position: relative;
          flex-shrink: 0;
          display: inline-flex;
        }

        .mmradar-icon {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid #C8AA6E;
          background-color: #0A1428;
        }

        /* Nivel de invocador superpuesto sobre el icono, mismo criterio
           visual que la referencia del usuario (numero chico anclado a
           la esquina inferior del circulo). Solo se dibuja si
           mmradar_level esta disponible (level !== null). */
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

        .mmradar-status {
          margin: 10px 0 0;
          font-size: 0.72rem;
        }

        .mmradar-status-success {
          color: #49B16F;
        }

        .mmradar-status-error {
          color: #e35d5d;
        }

        /* Rectangulo propio que envuelve el bloque de performance completo
           (label + rango + barra), mismo criterio visual que tenia el
           bloque de performance en PlayerCard antes de sacarse de ahi. */
        .mmradar-performance {
          margin-top: 16px;
          padding: 10px 12px;
          background: rgba(200, 170, 110, 0.08);
          border: 1px solid rgba(200, 170, 110, 0.25);
          border-radius: 3px;
        }

        .mmradar-performance-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .mmradar-performance-label {
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #a09b8c;
        }

        .mmradar-performance-rank {
          font-size: 0.78rem;
          font-weight: 700;
          color: #C8AA6E;
        }

        /* Barra de promedio: mas gruesa y con borde dorado propio para
           que se distinga de las 6 barras individuales de abajo sin
           necesidad de una etiqueta de texto tipo "Promedio" -- el pedido
           explicito fue que se note por su forma, no por texto nuevo. */
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

        .mmradar-average-fill {
          height: 100%;
          background: linear-gradient(to right, #C8AA6E, #f0e6d2, #4FC3E8);
        }

        .mmradar-average-value {
          flex-shrink: 0;
          min-width: 2ch;
          text-align: right;
          font-size: 0.95rem;
          font-weight: 700;
          color: #C8AA6E;
        }

        .mmradar-scores {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
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
        }
      `}</style>
    </div>
  );
}
