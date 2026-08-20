import { useState } from "react";
import { actions } from "astro:actions";
import type { Participant, MmradarPerformanceScores, MmradarTitle } from "@velada/core";
import { emitMmradarUpdate } from "../lib/mmradarUpdateBus";
import { resolveTitleColor } from "../lib/mmradarTitleColor";

/**
 * Bloque de datos de mmradar.gg para la ficha publica del jugador
 * (/peleadores/[id].astro): icono con nivel superpuesto + Riot ID +
 * server + tags de colores arriba (igual a la referencia visual del
 * usuario, ver captura de su propio perfil de mmradar.gg -- icono
 * circular con el nivel de invocador en una esquina, tags coloreados
 * segun el tipo de titulo, Riot ID grande, badge de servidor), barras de
 * las 6 stats de performance abajo, y un boton "Actualizar" opcional
 * (solo si el visitante es el dueno del perfil o un admin de panel) que
 * llama refreshMmradarData para re-consultar la fuente sin tener que
 * editar el resto del formulario. Si mmradar nunca respondio para este
 * jugador (performanceScores null) no se muestra nada de las barras, sin
 * dejar un hueco vacio -- mismo criterio que el resto de componentes que
 * consumen datos opcionales de mmradar (icono/server/nivel tambien caen
 * sin romper el layout si faltan).
 *
 * Participantes de meme (excludeFromMatches, ver
 * ParticipantSchema.memeTitles/memeIconUrl): no tienen lolUsername real,
 * asi que nunca van a tener icono/titulos/rango de mmradar. Pedido
 * explicito del usuario 2026-08-19: el icono, riot id y titulos van
 * SIEMPRE en este mismo cuadro (arriba del nombre), nunca en un bloque
 * aparte -- para un meme, memeIconUrl/memeTitles se usan como fallback
 * visual de icono/titulos cuando no hay datos reales de mmradar (nunca
 * los reemplazan si existen -- un meme no deberia tener lolUsername de
 * todos modos, pero por las dudas los reales siempre ganan).
 */

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
            <p className="mmradar-name">{participant.name}</p>
            {participant.lolUsername && <p className="mmradar-riot-id">{participant.lolUsername}</p>}
            <div className="mmradar-meta">
              {server && <span className="mmradar-server">{server}</span>}
              {performanceRank && <span className="mmradar-rank">{performanceRank}</span>}
            </div>
          </div>
        </div>

        {canUpdate && (
          <button type="button" className="mmradar-update-btn" onClick={handleUpdate} disabled={updating}>
            {updating ? "Actualizando..." : "Actualizar"}
          </button>
        )}
      </div>

      {status && <p className={`mmradar-status mmradar-status-${status.type}`}>{status.text}</p>}

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
          gap: 6px;
          margin-bottom: 14px;
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

        .mmradar-name {
          margin: 0;
          font-family: 'Oswald', 'Beaufort for LOL', sans-serif;
          font-weight: 700;
          font-size: 1.05rem;
          color: white;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .mmradar-riot-id {
          margin: 1px 0 0;
          font-size: 0.7rem;
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

        .mmradar-rank {
          font-size: 0.75rem;
          font-weight: 700;
          color: #C8AA6E;
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

        .mmradar-scores {
          margin-top: 16px;
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
