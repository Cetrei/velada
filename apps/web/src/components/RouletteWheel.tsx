import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Match, Participant, SpinStartPayload } from "@velada/core";
import { getSupabaseClient, ROULETTE_CHANNEL, SPIN_START_EVENT } from "../lib/supabase";

interface RouletteWheelProps {
  participants: Participant[];
  rouletteUnlocked: boolean;
  /**
   * Combates ya generados por la ruleta (is_random: true en la fila de
   * matches, ver AdminControl.triggerRandomMatch y lib/matches.ts),
   * pasados desde sorteo.astro. Antes RouletteWheel solo escuchaba el
   * broadcast en vivo (canal SPIN_START_EVENT): si alguien entraba a
   * /sorteo despues de que el sorteo ya se hizo -- o el admin ya la giro
   * antes de que este visitante se conectara -- la pagina se veia
   * "vacia" (rueda quieta, sin ningun combate) salvo que estuviera
   * conectado exactamente en el momento del broadcast. Con esto, si hay
   * matches generados y no hay nada girando ahora mismo, se listan como
   * resultados del sorteo en vez de mostrar la rueda sin nada.
   */
  existingMatches: Match[];
}

const WHEEL_COLORS = ["#C8AA6E", "#050914"];
const SPIN_DURATION_MS = 6000;
const EXTRA_SPINS = Math.PI * 2 * 10;

function drawWheel(
  canvas: HTMLCanvasElement,
  participants: Participant[],
  angle: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY) - 20;
  const sliceAngle = (2 * Math.PI) / participants.length;

  ctx.clearRect(0, 0, width, height);

  participants.forEach((participant, i) => {
    const startAngle = angle + i * sliceAngle;
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();

    ctx.fillStyle = WHEEL_COLORS[i % 2];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1E2A44";
    ctx.stroke();

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(startAngle + sliceAngle / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = i % 2 === 0 ? "#050914" : "#F0E6D2";
    ctx.font = "bold 16px Inter, sans-serif";
    ctx.fillText(participant.name.toUpperCase(), radius - 30, 0);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#050914";
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#C8AA6E";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX - 15, centerY - radius - 5);
  ctx.lineTo(centerX + 15, centerY - radius - 5);
  ctx.lineTo(centerX, centerY - radius + 25);
  ctx.fillStyle = "#0AC8B9";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#fff";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX, centerY, 35, 0, 2 * Math.PI);
  ctx.fillStyle = "#050914";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#C8AA6E";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX, centerY, 12, 0, 2 * Math.PI);
  ctx.fillStyle = "#C8AA6E";
  ctx.fill();
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

export default function RouletteWheel({ participants, rouletteUnlocked, existingMatches }: RouletteWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const isSpinningRef = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const [isSpinning, setIsSpinning] = useState(false);
  const [winnerPair, setWinnerPair] = useState<[Participant, Participant] | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [unlocked, setUnlocked] = useState(rouletteUnlocked);
  // Combates del sorteo ya generados (via prop) mas cualquiera que se
  // agregue en esta misma sesion (broadcast recibido o giro local) -- asi
  // la lista de "resultados del sorteo" crece en vivo sin recargar,
  // ademas de arrancar poblada con lo que ya existia en la base.
  const [pastPairs, setPastPairs] = useState<[Participant, Participant][]>(() =>
    resolvePairsFromMatches(existingMatches, participants)
  );

  function resolvePairsFromMatches(matches: Match[], pool: Participant[]): [Participant, Participant][] {
    const byId = new Map(pool.map((p) => [p.id, p]));
    const pairs: [Participant, Participant][] = [];
    for (const m of matches) {
      const p1 = byId.get(m.player1Id);
      const p2 = byId.get(m.player2Id);
      if (p1 && p2) pairs.push([p1, p2]);
    }
    return pairs;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && participants.length > 0) {
      drawWheel(canvas, participants, angleRef.current);
    }
  }, [participants]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setIsLive(false);
      return;
    }

    const channel = supabase
      .channel(ROULETTE_CHANNEL)
      .on("broadcast", { event: SPIN_START_EVENT }, ({ payload }) => {
        runSpin(payload as SpinStartPayload);
      })
      .subscribe((status) => {
        setIsLive(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    const eventStateChannel = supabase
      .channel("event_state_watch")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "event_state", filter: "id=eq.main" },
        (payload) => {
          const nextUnlocked = (payload.new as { roulette_unlocked?: boolean })
            .roulette_unlocked;
          if (typeof nextUnlocked === "boolean") {
            setUnlocked(nextUnlocked);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(eventStateChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants]);

  function findParticipant(id: string): Participant | undefined {
    return participants.find((p) => p.id === id);
  }

  function runSpin(payload: SpinStartPayload) {
    const canvas = canvasRef.current;
    if (!canvas || isSpinningRef.current || participants.length === 0) return;

    const player1 = findParticipant(payload.player1Id);
    const player2 = findParticipant(payload.player2Id);
    if (!player1 || !player2) return;

    const targetIndex = participants.findIndex((p) => p.id === payload.player2Id);
    if (targetIndex === -1) return;

    isSpinningRef.current = true;
    setIsSpinning(true);
    setWinnerPair(null);

    const sliceAngle = (2 * Math.PI) / participants.length;
    const targetBaseAngle =
      -(targetIndex * sliceAngle) - sliceAngle / 2 - Math.PI / 2;
    const startAngle = angleRef.current;
    const finalAngle =
      startAngle + EXTRA_SPINS + (targetBaseAngle - (startAngle % (Math.PI * 2)));

    const startTime = performance.now();

    function step(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / SPIN_DURATION_MS, 1);
      const current = startAngle + (finalAngle - startAngle) * easeOutQuart(progress);

      angleRef.current = current;
      if (canvas) drawWheel(canvas, participants, current);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        isSpinningRef.current = false;
        setIsSpinning(false);
        setWinnerPair([player1, player2]);
        setPastPairs((prev) => [...prev, [player1, player2]]);
      }
    }

    requestAnimationFrame(step);
  }

  async function triggerLocalSpin() {
    if (isSpinningRef.current || participants.length < 2) return;

    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const player1 = shuffled[0];
    const player2 = shuffled[1];
    // TS no puede inferir el largo de un array via destructuring, asi que
    // shuffled[0]/[1] tipan como Participant | undefined pese al guard de
    // participants.length < 2 de arriba (ver linea 194 en el reporte del
    // IDE: setWinnerPair exige la tupla [Participant, Participant] sin
    // undefined). Guard explicito para que el resto de la funcion trabaje
    // con Participant ya angosto.
    if (!player1 || !player2) return;

    const payload: SpinStartPayload = {
      player1Id: player1.id,
      player2Id: player2.id,
      timestamp: Date.now()
    };

    const supabase = getSupabaseClient();
    if (supabase && isLive) {
      await supabase.channel(ROULETTE_CHANNEL).send({
        type: "broadcast",
        event: SPIN_START_EVENT,
        payload
      });
      return;
    }

    // Standalone fallback: no Supabase connection, animate locally.
    runSpin(payload);
  }

  if (!unlocked) {
    return (
      <div className="bg-lol-cardBg border border-lol-border p-12 rounded-xl text-center">
        <h3 className="font-display text-2xl font-bold text-white uppercase mb-2">
          Sorteo Bloqueado
        </h3>
        <p className="text-slate-400">
          El sorteo se habilitará cuando el evento comience. Vuelve pronto.
        </p>
      </div>
    );
  }

  // Si ya hay combates generados por el sorteo y no se esta girando nada
  // ahora mismo (ni animacion local, ni un winnerPair recien resuelto en
  // esta sesion), se listan como resultados en vez de mostrar la rueda
  // "quieta" sin ningun dato -- cubre el caso de entrar a /sorteo despues
  // de que el sorteo ya paso. Si el visitante ve un broadcast en vivo
  // mientras esta parado en esta pantalla, winnerPair pasa a tener valor y
  // esa rama toma prioridad (se sigue viendo la rueda + el resultado
  // recien salido), y ese resultado ya quedo agregado a pastPairs arriba.
  if (!isSpinning && !winnerPair && pastPairs.length > 0) {
    return (
      <div className="w-full">
        <div className="bg-lol-cardBg border border-lol-border p-8 rounded-xl text-center mb-10">
          <h3 className="font-display text-2xl font-bold text-white uppercase mb-2">Sorteo Ya Realizado</h3>
          <p className="text-slate-400 text-sm">
            Estos son los combates que salieron del sorteo. {isLive ? "Si se gira otro, aparecera aca en vivo." : ""}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {pastPairs.map(([p1, p2], i) => (
            <div
              key={`${p1.id}-${p2.id}-${i}`}
              className="bg-black/50 backdrop-blur border border-lol-gold/60 rounded-xl p-6 text-center relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-lol-gold m-2" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-lol-gold m-2" />
              <div className="flex items-center justify-center gap-4">
                {[p1, p2].map((fighter, idx) => (
                  <div key={fighter.id} className="flex flex-col items-center">
                    <p className="text-sm text-lol-gold font-display italic mb-1">"{fighter.nickname}"</p>
                    <p className="text-lg font-display font-bold text-white uppercase tracking-wide">
                      {fighter.name}
                    </p>
                    {idx === 0 && <span className="text-lol-blue font-bold mt-2 text-xs">VS</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row items-center gap-16 w-full">
      <div className="relative flex flex-col items-center w-full lg:w-1/2">
        <div className="relative shadow-[0_0_80px_rgba(200,170,110,0.15)] rounded-full p-2 border border-lol-border/50 bg-lol-cardBg/50 backdrop-blur">
          <canvas
            ref={canvasRef}
            width={400}
            height={400}
            className="rounded-full max-w-full h-auto w-[340px] sm:w-[400px]"
          />
        </div>
        <span
          className={`mt-4 text-xs font-bold uppercase tracking-widest ${isLive ? "text-lol-blue" : "text-slate-500"}`}
        >
          {isLive ? "● En vivo" : "○ Modo local (sin conexión en tiempo real)"}
        </span>
      </div>

      <div className="flex flex-col items-center justify-center w-full lg:w-1/2 space-y-8">
        <div className="bg-lol-cardBg border border-lol-border p-8 rounded-xl w-full text-center relative overflow-hidden">
          <h3 className="text-2xl font-display font-bold text-white uppercase mb-2">
            Sorteo Oficial
          </h3>
          <p className="text-sm text-slate-400 mb-6">
            Presiona para emparejar aleatoriamente a los combatientes.
          </p>

          <button
            onClick={triggerLocalSpin}
            disabled={isSpinning || participants.length < 2}
            className="w-full py-5 px-6 bg-gradient-to-r from-lol-gold to-yellow-600 hover:from-yellow-500 hover:to-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-display font-bold text-xl transition-all transform hover:-translate-y-1 shadow-[0_10px_20px_rgba(200,170,110,0.3)] clip-edges uppercase tracking-wider"
          >
            {isSpinning ? "Girando..." : "Girar Ruleta"}
          </button>
        </div>

        {winnerPair && (
          <div className="bg-black/50 backdrop-blur border border-lol-gold rounded-xl p-8 text-center shadow-[0_0_40px_rgba(200,170,110,0.2)] w-full relative overflow-hidden">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-lol-gold m-2" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-lol-gold m-2" />

            <h4 className="text-lol-blue font-bold tracking-widest uppercase mb-6 text-sm">
              ¡Combate Confirmado!
            </h4>

            <div className="flex items-center justify-center gap-6">
              {winnerPair.map((fighter, i) => (
                <div key={fighter.id} className="flex flex-col items-center">
                  <p className="text-lg text-lol-gold font-display italic mb-1">
                    "{fighter.nickname}"
                  </p>
                  <p className="text-2xl font-display font-bold text-white uppercase tracking-wide">
                    {fighter.name}
                  </p>
                  <span className="text-slate-400 text-xs uppercase mt-1">
                    {fighter.mainRole}
                  </span>
                  {i === 0 && <span className="text-lol-blue font-bold mt-3">VS</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
