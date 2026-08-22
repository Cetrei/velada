import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Match, Participant, SpinStartPayload } from "@velada/core";
import { pickNextPair, pickBalancedPair, countRandomAppearances, PAGES, ADMIN_CONTROL, type RouletteRatingInput } from "@velada/core";
import { getSupabaseClient, ROULETTE_CHANNEL, SPIN_START_EVENT } from "../lib/supabase";
import { hasUnseenRaffleResults, markRaffleResultsSeen } from "../lib/revealTracking";
import SequentialReveal from "./SequentialReveal";

interface RouletteWheelProps {
  participants: Participant[];
  rouletteUnlocked: boolean;
  existingMatches: Match[];
}

/** Un par ya sorteado, con una clave estable para tracking de "ya visto". */
interface RaffledPair {
  key: string;
  player1: Participant;
  player2: Participant;
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

/** Clave estable por match para el tracking de "visto" -- prioriza el id
 * real (uuid de Supabase); si falta (insert cuya fila no volvio con id,
 * ver AdminControl.triggerRandomMatch) cae a una combinacion de los dos
 * jugadores + createdAt, suficiente para no colisionar entre pares
 * distintos dentro de la misma carga de la pagina. */
function pairKey(m: { id?: string; player1Id: string; player2Id: string; createdAt?: string }): string {
  return m.id ?? `${m.player1Id}-${m.player2Id}-${m.createdAt ?? ""}`;
}

function resolvePairsFromMatches(matches: Match[], pool: Participant[]): RaffledPair[] {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const pairs: RaffledPair[] = [];
  for (const m of matches) {
    const p1 = byId.get(m.player1Id);
    const p2 = byId.get(m.player2Id);
    if (p1 && p2) pairs.push({ key: pairKey(m), player1: p1, player2: p2 });
  }
  return pairs;
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
  const [pastPairs, setPastPairs] = useState<RaffledPair[]>(() =>
    resolvePairsFromMatches(existingMatches, participants)
  );
  // Modo del sorteo -- mismo criterio que AdminControl (pedido del usuario
  // 2026-08-21: modo "equilibrado" ademas del aleatorio, sin modo
  // "desventaja"). Este flujo es publico (sin gate de admin), a diferencia
  // de AdminControl que vive detras del login del panel -- el selector se
  // muestra igual, elegir el modo del proximo giro no es una accion
  // administrativa sensible como si lo es excluir participantes (por eso
  // ESE control no se replico aca, ver AGENT.md sesion 7).
  const [rouletteMode, setRouletteMode] = useState<"random" | "balanced">("random");

  // Presentacion secuencial en la primera visita despues de que el sorteo
  // ya salio (pedido del usuario 2026-08-21): se calcula UNA sola vez al
  // montar, con los pares que ya vinieron del server -- si mientras se
  // esta viendo la revelacion entra un giro nuevo en vivo, ese no se suma
  // a la revelacion en curso (se vera en la grilla normal apenas termine),
  // para no mover el piso bajo los pies de alguien que ya esta a mitad de
  // la animacion.
  const initialPairsRef = useRef<RaffledPair[] | null>(null);
  if (initialPairsRef.current === null) {
    initialPairsRef.current = resolvePairsFromMatches(existingMatches, participants);
  }
  // Arranca en null ("todavia no se sabe") en vez de calcular
  // hasUnseenRaffleResults ya en el useState inicial -- ese initializer
  // corre tambien en el render de servidor de este componente client:load,
  // y en el servidor localStorage no existe (revealTracking.ts devuelve un
  // Set vacio ahi), asi que siempre daba "no visto" en el HTML inicial sin
  // importar lo que diga el localStorage real del visitante -- ese HTML se
  // pintaba un instante antes de que el primer effect del cliente corrija
  // el valor, y ese instante era el flash de la animacion reportado por el
  // usuario en visitas donde ya estaba todo visto. Mismo patron que ya usan
  // LandingCombatesGate/LandingRaffleCta (null -> resuelve en useEffect).
  const [revealPending, setRevealPending] = useState<boolean | null>(null);
  const [revealIndex, setRevealIndex] = useState(0);

  useEffect(() => {
    const ids = initialPairsRef.current!.map((p) => p.key);
    setRevealPending(hasUnseenRaffleResults(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finishReveal() {
    const ids = initialPairsRef.current!.map((p) => p.key);
    markRaffleResultsSeen(ids);
    setRevealPending(false);
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
        const key = payload.matchId ?? `${player1.id}-${player2.id}-${payload.timestamp}`;
        setPastPairs((prev) => [...prev, { key, player1, player2 }]);
        // Un giro que ocurre EN VIVO ya lo esta viendo el espectador en el
        // momento (la animacion de la ruleta misma es la revelacion) -- se
        // marca visto de una vez para que no dispare la presentacion
        // secuencial de nuevo la proxima vez que entre a /sorteo.
        markRaffleResultsSeen([key]);
      }
    }

    requestAnimationFrame(step);
  }

  async function triggerLocalSpin() {
    // Guard de re-entrada sincrono -- chequeo y set en el mismo tick, ANTES
    // de calcular el par y de cualquier await. isSpinningRef.current recien
    // se ponia en true DENTRO de runSpin, que en el flujo "live" corre
    // despues de un `await supabase...send(...)` -- dos clicks casi
    // simultaneos en "Girar Ruleta" podian entrar los dos con
    // isSpinningRef.current todavia en false, calcular pickNextPair sobre el
    // mismo pastPairs, y salir con el mismo par (o repetir peleador) antes
    // de que el primero terminara de marcar el flag. Bug real 2026-08-21.
    if (isSpinningRef.current || participants.length < 2) return;
    isSpinningRef.current = true;

    // pickNextPair sobre pastPairs (estado MAS FRESCO de esta sesion, no un
    // snapshot viejo) -- mismas reglas de cobertura sin repeticion que
    // AdminControl.triggerRandomMatch, ver packages/core/roulette.ts.
    const existingAsMatches = pastPairs.map((p) => ({
      player1Id: p.player1.id,
      player2Id: p.player2.id,
      isRandom: true
    }));
    const pair =
      rouletteMode === "balanced"
        ? pickBalancedPair(
            participants.map((p) => p.id),
            existingAsMatches,
            new Map<string, RouletteRatingInput>(
              participants.map((p) => [p.id, { duelRating: p.duelRating, lolRank: p.lolRank }])
            )
          )
        : pickNextPair(
            participants.map((p) => p.id),
            existingAsMatches
          );
    if (!pair) {
      isSpinningRef.current = false;
      return;
    }

    const player1 = findParticipant(pair.player1Id);
    const player2 = findParticipant(pair.player2Id);
    if (!player1 || !player2) {
      isSpinningRef.current = false;
      return;
    }

    const payload: SpinStartPayload = {
      player1Id: player1.id,
      player2Id: player2.id,
      timestamp: Date.now()
    };

    const supabase = getSupabaseClient();
    if (supabase && isLive) {
      // El flag ya quedo en true arriba -- se libera si el broadcast falla
      // sin llegar a runSpin (que es quien lo maneja en el caso exitoso, via
      // el evento recibido de vuelta por el propio canal).
      const result = await supabase.channel(ROULETTE_CHANNEL).send({
        type: "broadcast",
        event: SPIN_START_EVENT,
        payload
      });
      if (result !== "ok") isSpinningRef.current = false;
      return;
    }

    // Standalone fallback: no Supabase connection, animate locally.
    // isSpinningRef.current ya esta en true; runSpin lo reutiliza (no lo
    // vuelve a setear a true, ya lo esta) y lo libera el mismo al terminar.
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

  // revealPending === null: todavia no se resolvio el useEffect de arriba
  // (que lee localStorage, solo disponible en el cliente) -- placeholder
  // neutro para no arriesgar mostrar la rueda/grilla normal ni la
  // revelacion antes de saber cual de las dos le corresponde a este
  // visitante. Se resuelve en el primer paint del cliente, asi que este
  // estado dura un instante imperceptible en la practica.
  if (revealPending === null && initialPairsRef.current!.length > 0) {
    return <div className="h-96" aria-hidden="true" />;
  }

  // Presentacion secuencial: solo corre sobre los pares que YA estaban
  // generados al entrar (initialPairsRef), no sobre pastPairs (que puede
  // crecer en vivo mientras tanto). Termina en RaffleRevealCard y marca
  // como visto, dejando paso a la grilla normal de "Sorteo Ya Realizado".
  if (!isSpinning && !winnerPair && revealPending && initialPairsRef.current!.length > 0) {
    const revealPairs = initialPairsRef.current!;
    const current = revealPairs[Math.min(revealIndex, revealPairs.length - 1)];
    const copy = PAGES.raffle;

    return (
      <SequentialReveal
        total={revealPairs.length}
        currentIndex={revealIndex}
        onAdvance={setRevealIndex}
        onFinished={finishReveal}
        eyebrow={copy.revealEyebrow}
        title={copy.revealTitle}
        skipCta={copy.revealSkipCta}
      >
        <div className="bg-black/50 backdrop-blur border border-lol-gold rounded-xl p-8 text-center shadow-[0_0_40px_rgba(200,170,110,0.2)] w-full max-w-lg mx-auto relative overflow-hidden">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-lol-gold m-2" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-lol-gold m-2" />

          <h4 className="text-lol-blue font-bold tracking-widest uppercase mb-6 text-sm">
            Combate {revealIndex + 1}
          </h4>

          <div className="flex items-center justify-center gap-6">
            {[current.player1, current.player2].map((fighter, i) => (
              <div key={fighter.id} className="flex flex-col items-center flex-1 min-w-0">
                <img
                  src={fighter.photo ?? `https://placehold.co/120x120/0A1428/C8AA6E?text=${encodeURIComponent(fighter.nickname[0] ?? "?")}`}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover border-2 border-lol-gold/50 mb-3"
                />
                <p className="text-lg text-lol-gold font-display italic mb-1 truncate max-w-full">
                  "{fighter.nickname}"
                </p>
                <p className="text-xl font-display font-bold text-white uppercase tracking-wide truncate max-w-full">
                  {fighter.name}
                </p>
                <span className="text-slate-400 text-xs uppercase mt-1">{fighter.mainRole}</span>
                {i === 0 && <span className="text-lol-blue font-bold mt-3">VS</span>}
              </div>
            ))}
          </div>
        </div>
      </SequentialReveal>
    );
  }

  if (!isSpinning && !winnerPair && pastPairs.length > 0) {
    // Cobertura real (mismo criterio que pickNextPair en
    // packages/core/roulette.ts): cuantos participantes ya tuvieron al
    // menos un 1v1 sorteado, sobre el total del pool -- pedido del usuario
    // de poder ver de un vistazo si falta alguien por salir.
    const appearances = countRandomAppearances(
      pastPairs.map((p) => ({ player1Id: p.player1.id, player2Id: p.player2.id, isRandom: true }))
    );
    const coveredCount = participants.filter((p) => appearances.has(p.id)).length;
    const totalCount = participants.length;
    const coveragePct = totalCount > 0 ? Math.round((coveredCount / totalCount) * 100) : 0;
    const allCovered = coveredCount >= totalCount && totalCount > 0;
    const lastPairIndex = pastPairs.length - 1;

    return (
      <div className="w-full">
        <div className="bg-lol-cardBg border border-lol-border p-8 rounded-xl mb-10">
          <div className="text-center mb-6">
            <h3 className="font-display text-2xl font-bold text-white uppercase mb-2">Sorteo Ya Realizado</h3>
            <p className="text-slate-400 text-sm">
              Estos son los combates que salieron del sorteo.{" "}
              {isLive ? "Si se gira otro, aparecera aca en vivo." : ""}
            </p>
          </div>

          <div className="max-w-md mx-auto">
            <div className="flex items-center justify-between mb-2 text-xs uppercase tracking-wide">
              <span className="text-slate-500">Cobertura del sorteo</span>
              <span className={`font-bold ${allCovered ? "text-lol-gold" : "text-slate-300"}`}>
                {coveredCount}/{totalCount} peleadores
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-black/40 border border-lol-border/50">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  allCovered ? "bg-gradient-to-r from-lol-gold to-yellow-400" : "bg-gradient-to-r from-lol-blue to-lol-gold"
                }`}
                style={{ width: `${coveragePct}%` }}
              />
            </div>
            {allCovered && (
              <p className="text-lol-gold text-xs text-center mt-2 uppercase tracking-wide font-bold">
                Todos ya tuvieron su 1v1 -- el proximo giro arranca una ronda nueva
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {pastPairs.map((pair, i) => {
            const { player1: p1, player2: p2 } = pair;
            const isLast = i === lastPairIndex;
            return (
              <div
                key={pair.key}
                className={`relative overflow-hidden rounded-xl p-6 text-center backdrop-blur transition-colors ${
                  isLast
                    ? "bg-lol-gold/[0.07] border-2 border-lol-gold shadow-[0_0_30px_rgba(200,170,110,0.15)]"
                    : "bg-black/50 border border-lol-gold/40"
                }`}
              >
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-lol-gold m-2" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-lol-gold m-2" />
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Combate {i + 1}
                  </span>
                  {isLast && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-lol-gold">Ultimo</span>
                  )}
                </div>
                <div className="flex items-center justify-center gap-4">
                  {[p1, p2].map((fighter) => (
                    <div key={fighter.id} className="flex flex-col items-center flex-1 min-w-0">
                      <img
                        src={fighter.photo ?? `https://placehold.co/80x80/0A1428/C8AA6E?text=${encodeURIComponent(fighter.nickname[0] ?? "?")}`}
                        alt=""
                        loading="lazy"
                        className="w-14 h-14 rounded-full object-cover border-2 border-lol-gold/50 mb-2"
                      />
                      <p className="text-xs text-lol-gold font-display italic mb-0.5 truncate max-w-full">
                        "{fighter.nickname}"
                      </p>
                      <p className="text-sm font-display font-bold text-white uppercase tracking-wide truncate max-w-full">
                        {fighter.name}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <span className="flex-1 h-px bg-lol-border/40" />
                  <span className="text-lol-blue font-display font-bold text-xs">VS</span>
                  <span className="flex-1 h-px bg-lol-border/40" />
                </div>
              </div>
            );
          })}
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

          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              type="button"
              onClick={() => setRouletteMode("random")}
              disabled={isSpinning}
              className={`px-4 py-3 rounded border text-sm font-bold uppercase tracking-wide transition-all disabled:opacity-50 ${
                rouletteMode === "random"
                  ? "bg-lol-gold/10 border-lol-gold text-lol-gold"
                  : "bg-lol-darkBg border-lol-border text-slate-400 hover:border-lol-gold/50"
              }`}
            >
              {ADMIN_CONTROL.rouletteModeRandom}
            </button>
            <button
              type="button"
              onClick={() => setRouletteMode("balanced")}
              disabled={isSpinning}
              className={`px-4 py-3 rounded border text-sm font-bold uppercase tracking-wide transition-all disabled:opacity-50 ${
                rouletteMode === "balanced"
                  ? "bg-lol-gold/10 border-lol-gold text-lol-gold"
                  : "bg-lol-darkBg border-lol-border text-slate-400 hover:border-lol-gold/50"
              }`}
            >
              {ADMIN_CONTROL.rouletteModeBalanced}
            </button>
          </div>
          <p className="text-slate-500 text-xs mb-6 -mt-2">
            {rouletteMode === "balanced" ? ADMIN_CONTROL.rouletteModeBalancedHint : ADMIN_CONTROL.rouletteModeRandomHint}
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
