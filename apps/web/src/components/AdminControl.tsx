import { useRef, useState } from "react";
import type { Match, Participant, SpinStartPayload } from "@velada/core";
import { ADMIN_CONTROL, pickNextPair, countRandomAppearances } from "@velada/core";
import { getSupabaseClient, ROULETTE_CHANNEL, SPIN_START_EVENT } from "../lib/supabase";

interface AdminControlProps {
  participants: Participant[];
  initialMatches: Match[];
  initialRouletteUnlocked: boolean;
  initialStartTime: string;
  initialRegistrationsOpen: boolean;
  initialVotingEnabled: boolean;
  initialEventStarted: boolean;
}

type StatusMessage = { type: "success" | "error"; text: string } | null;

interface EventFlags {
  rouletteUnlocked: boolean;
  registrationsOpen: boolean;
  votingEnabled: boolean;
  eventStarted: boolean;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Converts an ISO string to the value <input type="datetime-local"> expects (local time, no seconds/offset). */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminControl({
  participants,
  initialMatches,
  initialRouletteUnlocked,
  initialStartTime,
  initialRegistrationsOpen,
  initialVotingEnabled,
  initialEventStarted
}: AdminControlProps) {
  const [flags, setFlags] = useState<EventFlags>({
    rouletteUnlocked: initialRouletteUnlocked,
    registrationsOpen: initialRegistrationsOpen,
    votingEnabled: initialVotingEnabled,
    eventStarted: initialEventStarted
  });
  // Combates ya sorteados (isRandom: true), para que pickNextPair sepa a
  // quien ya le toco un 1v1 y no lo repita mientras haya frescos --
  // arranca con lo que ya existia en la base y crece localmente cada vez
  // que se emite un sorteo nuevo desde este panel (ver triggerRandomMatch).
  const [matches, setMatches] = useState<Match[]>(initialMatches);
  // Exclusion temporal del sorteo 1v1 -- pedido del usuario: poder sacar a
  // alguien del CALCULO de la ruleta (ej. ya peleo, esta ausente) sin
  // tocar su ficha ni el flag permanente excludeFromMatches (ese excluye
  // de TODO, no solo del sorteo). Mismo patron/UI que excludedIds en
  // TeamMatchManager.tsx, pero en memoria nomas (no se persiste entre
  // recargas de pagina a proposito -- es una exclusion de "esta ronda",
  // no una propiedad del participante).
  const [excludedRouletteIds, setExcludedRouletteIds] = useState<Set<string>>(new Set());
  const [startTime, setStartTime] = useState(initialStartTime);
  const [startTimeInput, setStartTimeInput] = useState(toDatetimeLocalValue(initialStartTime));
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Guard de re-entrada para triggerRandomMatch -- useRef (no useState) porque
  // necesita ser sincrono y visible DENTRO del mismo tick de un segundo click,
  // antes de que React llegue a re-renderizar con isBusy=true. Bug real
  // encontrado 2026-08-21: dos clicks casi simultaneos en "Emitir sorteo"
  // corrian pickNextPair(participants, matches) DOS VECES sobre el mismo
  // `matches` (el primer setMatches recien se aplica despues de los awaits de
  // broadcast+insert), asi que ambos calculos podian elegir el mismo par o
  // pisarse la cobertura -- de ahi los duplicados y el contador que nunca
  // llegaba a mostrar n/n antes de reiniciar la ronda.
  const isEmittingRef = useRef(false);

  const supabase = getSupabaseClient();
  const isConnected = supabase !== null;

  async function updateFlag(key: keyof EventFlags, value: boolean) {
    if (!supabase) {
      setStatus({ type: "error", text: ADMIN_CONTROL.errorNotConnected });
      return;
    }

    const nextFlags = { ...flags, [key]: value };

    setIsBusy(true);
    try {
      const { error } = await supabase
        .from("event_state")
        .update({
          roulette_unlocked: nextFlags.rouletteUnlocked,
          registrations_open: nextFlags.registrationsOpen,
          voting_enabled: nextFlags.votingEnabled,
          event_started: nextFlags.eventStarted,
          updated_at: new Date().toISOString()
        })
        .eq("id", "main");

      if (error) {
        setStatus({ type: "error", text: `Error actualizando el estado: ${error.message}` });
        return;
      }

      setFlags(nextFlags);
      setStatus({ type: "success", text: "Estado del evento actualizado." });
    } catch (err) {
      setStatus({ type: "error", text: ADMIN_CONTROL.errorUnexpected(errorMessage(err)) });
    } finally {
      setIsBusy(false);
    }
  }

  async function saveStartTime() {
    if (!supabase) {
      setStatus({ type: "error", text: ADMIN_CONTROL.errorNotConnected });
      return;
    }
    if (!startTimeInput) {
      setStatus({ type: "error", text: ADMIN_CONTROL.errorStartTimeEmpty });
      return;
    }

    const parsed = new Date(startTimeInput);
    if (Number.isNaN(parsed.getTime())) {
      setStatus({ type: "error", text: ADMIN_CONTROL.errorStartTimeEmpty });
      return;
    }
    const nextStartTime = parsed.toISOString();

    setIsBusy(true);
    try {
      const { error } = await supabase
        .from("event_state")
        .update({
          start_time: nextStartTime,
          updated_at: new Date().toISOString()
        })
        .eq("id", "main");

      if (error) {
        setStatus({ type: "error", text: `Error actualizando la fecha: ${error.message}` });
        return;
      }

      setStartTime(nextStartTime);
      setStatus({ type: "success", text: ADMIN_CONTROL.successStartTimeUpdated });
    } catch (err) {
      setStatus({ type: "error", text: ADMIN_CONTROL.errorUnexpected(errorMessage(err)) });
    } finally {
      setIsBusy(false);
    }
  }

  async function triggerRandomMatch() {
    if (!supabase) {
      setStatus({ type: "error", text: "Supabase no está configurado. No se puede emitir en vivo." });
      return;
    }
    const availableParticipants = participants.filter((p) => !excludedRouletteIds.has(p.id));
    if (availableParticipants.length < 2) {
      setStatus({ type: "error", text: ADMIN_CONTROL.rouletteNotEnoughAvailable });
      return;
    }
    // Guard de re-entrada sincrono: si ya hay un giro en vuelo (entre el
    // pickNextPair de una llamada anterior y que su setMatches termine de
    // aplicarse), un segundo click no debe ni siquiera calcular un par --
    // leeria el mismo `matches` desactualizado y podia repetir peleador.
    // Chequeo y set en el mismo tick sincrono, antes de cualquier await.
    if (isEmittingRef.current) return;
    isEmittingRef.current = true;

    // pickNextPair recalculado con el estado `matches` MAS FRESCO disponible
    // (no un snapshot capturado antes) -- prioriza a quien todavia no salio
    // en ningun sorteo, y solo repite forzosamente cuando queda 1 sobrante
    // sin pareja. El pool ya viene filtrado de excludedRouletteIds -- un
    // participante excluido no puede salir sorteado, pero SI sigue contando
    // para la cobertura de matches previos en los que ya haya salido antes
    // de ser excluido (pickNextPair solo mira el pool que se le pasa).
    const pair = pickNextPair(
      availableParticipants.map((p) => p.id),
      matches
    );
    if (!pair) {
      setStatus({ type: "error", text: "No se pudo armar un par -- revisa el roster." });
      isEmittingRef.current = false;
      return;
    }
    const player1 = participants.find((p) => p.id === pair.player1Id);
    const player2 = participants.find((p) => p.id === pair.player2Id);
    if (!player1 || !player2) {
      setStatus({ type: "error", text: "No se pudo armar un par -- revisa el roster." });
      isEmittingRef.current = false;
      return;
    }

    setIsBusy(true);
    try {
      const payload: SpinStartPayload = {
        player1Id: player1.id,
        player2Id: player2.id,
        timestamp: Date.now()
      };

      const broadcastResult = await supabase.channel(ROULETTE_CHANNEL).send({
        type: "broadcast",
        event: SPIN_START_EVENT,
        payload
      });

      const { data: insertedRows, error: insertError } = await supabase
        .from("matches")
        .insert([
          {
            player1_id: player1.id,
            player2_id: player2.id,
            is_random: true
          }
        ])
        .select("id, player1_id, player2_id, is_random, created_at");

      if (broadcastResult !== "ok" || insertError) {
        setStatus({
          type: "error",
          text: insertError ? `Error guardando el combate: ${insertError.message}` : "Error emitiendo el sorteo."
        });
        return;
      }

      // Aunque el insert haya fallado en devolver la fila (RLS/select
      // restringido), el par ya esta confirmado y emitido -- lo agregamos
      // igual al estado local minimo para que pickNextPair lo vea en el
      // proximo giro de esta misma sesion, aunque no tengamos el id real.
      const insertedRow = insertedRows?.[0];
      setMatches((prev) => [
        ...prev,
        {
          id: insertedRow?.id,
          player1Id: player1.id,
          player2Id: player2.id,
          isRandom: true,
          predictionsOpen: false,
          createdAt: insertedRow?.created_at
        }
      ]);

      setStatus({ type: "success", text: `Combate emitido: ${player1.name} vs ${player2.name}` });
    } catch (err) {
      setStatus({ type: "error", text: ADMIN_CONTROL.errorUnexpected(errorMessage(err)) });
    } finally {
      setIsBusy(false);
      isEmittingRef.current = false;
    }
  }

  function toggleRouletteExclusion(id: string) {
    setExcludedRouletteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function markAllRouletteExcluded() {
    setExcludedRouletteIds(new Set(participants.map((p) => p.id)));
  }

  function unmarkAllRouletteExcluded() {
    setExcludedRouletteIds(new Set());
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-sm text-slate-400">
            {isConnected ? ADMIN_CONTROL.connected : ADMIN_CONTROL.disconnected}
          </span>
        </div>

        {status && (
          <div
            className={`text-sm p-3 rounded mb-4 ${
              status.type === "success"
                ? "bg-green-900/30 text-green-400 border border-green-800"
                : "bg-red-900/30 text-red-400 border border-red-800"
            }`}
          >
            {status.text}
          </div>
        )}

        <h3 className="font-display text-xl font-bold text-white uppercase mb-1">{ADMIN_CONTROL.startTimeTitle}</h3>
        <p className="text-xs text-slate-500 mb-3">{new Date(startTime).toLocaleString()}</p>
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <label className="flex-1">
            <span className="sr-only">{ADMIN_CONTROL.startTimeLabel}</span>
            <input
              type="datetime-local"
              value={startTimeInput}
              onChange={(e) => setStartTimeInput(e.target.value)}
              className="w-full bg-lol-darkBg border border-lol-border rounded px-4 py-3 text-white focus:border-lol-gold outline-none"
            />
          </label>
          <button
            type="button"
            disabled={isBusy}
            onClick={saveStartTime}
            className="px-6 py-3 bg-lol-blue/10 border border-lol-blue text-lol-blue hover:bg-lol-blue hover:text-black font-bold uppercase tracking-wide transition-all disabled:opacity-50 whitespace-nowrap"
          >
            {ADMIN_CONTROL.saveStartTimeCta}
          </button>
        </div>

        <h3 className="font-display text-xl font-bold text-white uppercase mb-1">{ADMIN_CONTROL.stateTitle}</h3>
        <p className="text-xs text-slate-500 mb-4">{ADMIN_CONTROL.stateHint}</p>
        <div className="space-y-3 mb-6">
          <EventFlagToggle
            label={ADMIN_CONTROL.registrationsLabel}
            onState={ADMIN_CONTROL.registrationsOpenState}
            offState={ADMIN_CONTROL.registrationsClosedState}
            checked={flags.registrationsOpen}
            disabled={isBusy}
            onToggle={(v) => updateFlag("registrationsOpen", v)}
          />
          <EventFlagToggle
            label={ADMIN_CONTROL.rouletteLabel}
            onState={ADMIN_CONTROL.rouletteEnabledState}
            offState={ADMIN_CONTROL.rouletteDisabledState}
            checked={flags.rouletteUnlocked}
            disabled={isBusy}
            onToggle={(v) => updateFlag("rouletteUnlocked", v)}
          />
          <EventFlagToggle
            label={ADMIN_CONTROL.votingLabel}
            onState={ADMIN_CONTROL.votingEnabledState}
            offState={ADMIN_CONTROL.votingDisabledState}
            checked={flags.votingEnabled}
            disabled={isBusy}
            onToggle={(v) => updateFlag("votingEnabled", v)}
          />
          <EventFlagToggle
            label={ADMIN_CONTROL.eventStartedLabel}
            onState={ADMIN_CONTROL.eventStartedOnState}
            offState={ADMIN_CONTROL.eventStartedOffState}
            checked={flags.eventStarted}
            disabled={isBusy}
            onToggle={(v) => updateFlag("eventStarted", v)}
          />
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm uppercase text-slate-400 font-bold">
              {ADMIN_CONTROL.rouletteExcludeTitle}
            </span>
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                onClick={markAllRouletteExcluded}
                className="text-lol-blue hover:underline font-bold uppercase"
              >
                {ADMIN_CONTROL.rouletteMarkAllCta}
              </button>
              <button
                type="button"
                onClick={unmarkAllRouletteExcluded}
                className="text-lol-blue hover:underline font-bold uppercase"
              >
                {ADMIN_CONTROL.rouletteUnmarkAllCta}
              </button>
            </div>
          </div>
          <p className="text-slate-500 text-xs mb-3">{ADMIN_CONTROL.rouletteExcludeHint}</p>
          <p className="text-slate-500 text-xs mb-3">
            {ADMIN_CONTROL.rouletteExcludedHint(excludedRouletteIds.size, participants.length)}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
            {participants.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 bg-lol-darkBg border border-lol-border/50 rounded px-3 py-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={excludedRouletteIds.has(p.id)}
                  onChange={() => toggleRouletteExclusion(p.id)}
                  className="accent-lol-gold"
                />
                <span className={`truncate ${excludedRouletteIds.has(p.id) ? "text-slate-500 line-through" : "text-white"}`}>
                  {p.name}
                </span>
              </label>
            ))}
          </div>
        </div>

        <button
          disabled={isBusy || !flags.rouletteUnlocked}
          onClick={triggerRandomMatch}
          className="w-full py-4 px-6 bg-gradient-to-r from-lol-gold to-yellow-600 hover:from-yellow-500 hover:to-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-display font-bold text-lg uppercase tracking-wide"
        >
          {ADMIN_CONTROL.emitRandomMatch}
        </button>
        <RouletteCoverageHint participants={participants} matches={matches} excludedIds={excludedRouletteIds} />
      </div>

      <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
        <h3 className="font-display text-xl font-bold text-white uppercase mb-4">
          {ADMIN_CONTROL.loadedFighters(participants.length)}
        </h3>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm text-slate-300">
          {participants.map((p) => (
            <li key={p.id} className="bg-lol-darkBg border border-lol-border/50 rounded px-3 py-2">
              {p.name} <span className="text-slate-500">({p.mainRole})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EventFlagToggle({
  label,
  onState,
  offState,
  checked,
  disabled,
  onToggle
}: {
  label: string;
  onState: string;
  offState: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(!checked)}
      className={`w-full flex items-center justify-between gap-4 px-4 py-3 rounded border transition-all disabled:opacity-50 ${
        checked
          ? "bg-lol-gold/10 border-lol-gold"
          : "bg-lol-darkBg border-lol-border hover:border-lol-gold/50"
      }`}
    >
      <span className="text-sm font-bold uppercase tracking-wide text-white">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`text-xs uppercase font-bold ${checked ? "text-lol-gold" : "text-slate-500"}`}>
          {checked ? onState : offState}
        </span>
        <span
          className={`relative w-10 h-5 rounded-full transition-colors ${
            checked ? "bg-lol-gold" : "bg-lol-border"
          }`}
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full bg-black transition-[left] duration-200"
            style={{ left: checked ? "22px" : "2px" }}
          />
        </span>
      </span>
    </button>
  );
}

/**
 * Hint chico bajo el boton de "Emitir sorteo" -- pedido del usuario de ver
 * cobertura sin tener que ir a /sorteo. Mismo criterio de conteo que
 * countRandomAppearances/pickNextPair (packages/core/roulette.ts): solo
 * cuenta apariciones en combates isRandom, no los cargados a mano.
 *
 * excludedIds (exclusion temporal del sorteo, ver AdminControl arriba) se
 * resta del total antes de calcular cobertura -- alguien excluido no
 * deberia contar como "pendiente" ya que no puede salir sorteado mientras
 * este marcado, sin importar si ya tuvo su 1v1 o no.
 */
function RouletteCoverageHint({
  participants,
  matches,
  excludedIds
}: {
  participants: Participant[];
  matches: Match[];
  excludedIds: Set<string>;
}) {
  const appearances = countRandomAppearances(matches);
  const availableParticipants = participants.filter((p) => !excludedIds.has(p.id));
  const coveredCount = availableParticipants.filter((p) => appearances.has(p.id)).length;
  const totalCount = availableParticipants.length;
  if (totalCount === 0) return null;

  const allCovered = coveredCount >= totalCount;

  return (
    <p className="text-xs text-center mt-3 text-slate-500">
      Cobertura del sorteo:{" "}
      <span className={allCovered ? "text-lol-gold font-bold" : "text-slate-300 font-bold"}>
        {coveredCount}/{totalCount}
      </span>{" "}
      {allCovered ? "-- el proximo giro arranca una ronda nueva" : "peleadores ya tuvieron su 1v1"}
      {excludedIds.size > 0 && <span className="block mt-1">({excludedIds.size} excluidos del calculo)</span>}
    </p>
  );
}
