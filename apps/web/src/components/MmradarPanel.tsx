import { useState } from "react";
import { actions } from "astro:actions";
import type { Participant, MmradarPerformanceScores, MmradarTitle } from "@velada/core";
import { emitMmradarUpdate } from "../lib/mmradarUpdateBus";
import MmradarPerformanceCard from "./MmradarPerformanceCard";
import DuelRatingCard from "./DuelRatingCard";

type ParticipantMmradarData = Pick<
  Participant,
  | "id"
  | "name"
  | "lolUsername"
  | "lolRank"
  | "performanceRank"
  | "performanceScores"
  | "titles"
  | "mmradarIconUrl"
  | "mmradarServer"
  | "mmradarLevel"
  | "duelRating"
  | "duelConfidence"
  | "memeTitles"
  | "memeIconUrl"
>;

/** Rival ya asignado en la ruleta (ver `rival` en peleadores/[id].astro), pasado tal cual para calcular la probabilidad de un 1v1. */
export interface DuelRivalData {
  name: string;
  duelRating?: number | null;
  lolRank?: string | null;
}

interface MmradarPanelProps {
  participant: ParticipantMmradarData;
  /** Solo el dueno del perfil o un admin de panel puede forzar una re-consulta. */
  canUpdate: boolean;
  /** Notifica al padre (PlayerCardLive) cuando hay datos nuevos, ver mmradarUpdateBus. */
  onUpdated?: (data: { performanceRank: string | null; performanceScores: MmradarPerformanceScores | null }) => void;
  /** Rival ya asignado (ver peleadores/[id].astro) para mostrar probabilidad de 1v1 -- opcional. */
  rival?: DuelRivalData | null;
}

type StatusMessage = { type: "success" | "error"; text: string } | null;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Wrapper con estado para la ficha ya guardada (/peleadores/[id]): maneja
 * el boton "Actualizar" (refreshMmradarData) y el fallback de meme
 * (memeTitles/memeIconUrl). El render vive centralizado en
 * MmradarPerformanceCard, compartido con el preview de /mi-perfil.
 */
export default function MmradarPanel({ participant, canUpdate, onUpdated, rival }: MmradarPanelProps) {
  const [scores, setScores] = useState(participant.performanceScores ?? null);
  const [performanceRank, setPerformanceRank] = useState(participant.performanceRank ?? null);
  const [titles, setTitles] = useState(participant.titles ?? null);
  const [iconUrl, setIconUrl] = useState(participant.mmradarIconUrl ?? null);
  const [server, setServer] = useState(participant.mmradarServer ?? null);
  const [level, setLevel] = useState(participant.mmradarLevel ?? null);
  const [duelRating, setDuelRating] = useState(participant.duelRating ?? null);
  const [duelConfidence, setDuelConfidence] = useState(participant.duelConfidence ?? null);
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);

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
        setDuelRating(data.duelRating ?? null);
        setDuelConfidence(data.duelConfidence ?? null);
        setStatus({ type: "success", text: "Datos actualizados." });
        onUpdated?.({ performanceRank: data.performanceRank ?? null, performanceScores: data.performanceScores ?? null });
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
    <>
      <MmradarPerformanceCard
        size="full"
        titles={displayTitles}
        riotId={participant.lolUsername}
        iconUrl={displayIconUrl}
        level={level}
        server={server}
        performanceRank={performanceRank}
        scores={scores}
        statusMessage={status}
        headerAction={
          canUpdate ? (
            <button type="button" className="mmradar-update-btn" onClick={handleUpdate} disabled={updating}>
              {updating ? "Actualizando..." : "Actualizar"}
            </button>
          ) : undefined
        }
      />
      <DuelRatingCard
        size="full"
        duelRating={duelRating}
        duelConfidence={duelConfidence}
        name={participant.name}
        lolRank={participant.lolRank}
        rival={rival}
      />
    </>
  );
}
