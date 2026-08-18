import { useState } from "react";
import type { EventPhase, Participant, SpinStartPayload } from "@velada/core";
import { getSupabaseClient, ROULETTE_CHANNEL, SPIN_START_EVENT } from "../lib/supabase";

interface AdminControlProps {
  participants: Participant[];
  initialRouletteUnlocked: boolean;
  initialPhase: EventPhase;
}

const PHASES: EventPhase[] = ["COUNTDOWN", "SHOWCASE", "ROULETTE", "MATCHES", "ENDED"];

type StatusMessage = { type: "success" | "error"; text: string } | null;

export default function AdminControl({
  participants,
  initialRouletteUnlocked,
  initialPhase
}: AdminControlProps) {
  const [rouletteUnlocked, setRouletteUnlocked] = useState(initialRouletteUnlocked);
  const [phase, setPhase] = useState<EventPhase>(initialPhase);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [isBusy, setIsBusy] = useState(false);

  const supabase = getSupabaseClient();
  const isConnected = supabase !== null;

  async function updateEventState(nextRouletteUnlocked: boolean, nextPhase: EventPhase) {
    if (!supabase) {
      setStatus({ type: "error", text: "Supabase no está configurado. Corre bun run setup:supabase." });
      return;
    }

    setIsBusy(true);
    const { error } = await supabase
      .from("event_state")
      .update({
        roulette_unlocked: nextRouletteUnlocked,
        current_phase: nextPhase,
        updated_at: new Date().toISOString()
      })
      .eq("id", "main");

    setIsBusy(false);

    if (error) {
      setStatus({ type: "error", text: `Error actualizando el estado: ${error.message}` });
      return;
    }

    setRouletteUnlocked(nextRouletteUnlocked);
    setPhase(nextPhase);
    setStatus({ type: "success", text: "Estado del evento actualizado." });
  }

  async function triggerRandomMatch() {
    if (!supabase) {
      setStatus({ type: "error", text: "Supabase no está configurado. No se puede emitir en vivo." });
      return;
    }
    if (participants.length < 2) {
      setStatus({ type: "error", text: "Se necesitan al menos 2 participantes." });
      return;
    }

    setIsBusy(true);

    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const [player1, player2] = shuffled;

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

    const { error: insertError } = await supabase.from("matches").insert([
      {
        player1_id: player1.id,
        player2_id: player2.id,
        is_random: true
      }
    ]);

    setIsBusy(false);

    if (broadcastResult !== "ok" || insertError) {
      setStatus({
        type: "error",
        text: insertError ? `Error guardando el combate: ${insertError.message}` : "Error emitiendo el sorteo."
      });
      return;
    }

    setStatus({ type: "success", text: `Combate emitido: ${player1.name} vs ${player2.name}` });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-sm text-slate-400">
            {isConnected ? "Conectado a Supabase" : "Sin conexión a Supabase"}
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

        <h3 className="font-display text-xl font-bold text-white uppercase mb-4">Fase del evento</h3>
        <div className="flex flex-wrap gap-2 mb-6">
          {PHASES.map((p) => (
            <button
              key={p}
              disabled={isBusy}
              onClick={() => updateEventState(rouletteUnlocked, p)}
              className={`px-4 py-2 text-sm font-bold uppercase tracking-wide rounded disabled:opacity-50 ${
                phase === p
                  ? "bg-lol-gold text-black"
                  : "bg-lol-darkBg border border-lol-border text-slate-300 hover:border-lol-gold"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <h3 className="font-display text-xl font-bold text-white uppercase mb-4">Control del sorteo</h3>
        <button
          disabled={isBusy}
          onClick={() => updateEventState(!rouletteUnlocked, phase)}
          className="w-full py-3 px-6 bg-lol-blue/10 border border-lol-blue text-lol-blue hover:bg-lol-blue hover:text-black font-bold uppercase tracking-wide transition-all disabled:opacity-50 mb-4"
        >
          {rouletteUnlocked ? "Bloquear sorteo" : "Desbloquear sorteo"}
        </button>

        <button
          disabled={isBusy || !rouletteUnlocked}
          onClick={triggerRandomMatch}
          className="w-full py-4 px-6 bg-gradient-to-r from-lol-gold to-yellow-600 hover:from-yellow-500 hover:to-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-display font-bold text-lg uppercase tracking-wide"
        >
          Emitir sorteo aleatorio en vivo
        </button>
      </div>

      <div className="bg-lol-cardBg border border-lol-border p-6 rounded-xl">
        <h3 className="font-display text-xl font-bold text-white uppercase mb-4">
          Participantes cargados ({participants.length})
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
