import { useEffect, useState } from "react";

interface SequentialRevealProps {
  /** Cuantos items totales se van a revelar (para el contador y la barra). */
  total: number;
  /** Indice actual ya revelado (0-based, se llama cada vez que avanza). */
  currentIndex: number;
  /** Milisegundos entre cada avance automatico. */
  intervalMs?: number;
  /** Se dispara cuando se revelo el ultimo item y paso el delay final. */
  onFinished: () => void;
  /** Delay extra despues de revelar el ultimo item, antes de onFinished. */
  finishDelayMs?: number;
  onAdvance: (nextIndex: number) => void;
  children: React.ReactNode;
  eyebrow: string;
  title: string;
  skipCta: string;
  /**
   * Si es false, el timer de avance automatico se pausa (el contenido
   * sigue montado tal cual este, esto solo controla el reloj). Pensado
   * para paneles detras de un tab de CSS puro que sigue montado mientras
   * esta oculto -- ver useTabActive.ts. Default true (siempre activo).
   */
  active?: boolean;
}

/**
 * Shell visual + timer para revelar una lista de resultados de a uno,
 * pedido del usuario 2026-08-21 para dar inmersividad la primera vez que
 * alguien ve el sorteo o los combates por equipo ya generados: en vez de
 * la grilla plana de siempre, se presentan secuencialmente como si fuera
 * un anuncio en vivo.
 *
 * Puramente de presentacion (avanza solo con un timer + boton "Saltar"):
 * el contenido de cada paso lo decide el caller via `children`, este
 * componente solo maneja el avance/contador/barra de progreso para no
 * duplicar esa logica entre el reveal de 1v1 y el de equipos.
 */
export default function SequentialReveal({
  total,
  currentIndex,
  intervalMs = 2600,
  onFinished,
  finishDelayMs = 1400,
  onAdvance,
  children,
  eyebrow,
  title,
  skipCta,
  active = true
}: SequentialRevealProps) {
  const [isSkipped, setIsSkipped] = useState(false);

  useEffect(() => {
    if (isSkipped || !active) return;

    const isLast = currentIndex >= total - 1;
    const delay = isLast ? finishDelayMs : intervalMs;

    const timer = setTimeout(() => {
      if (isLast) {
        onFinished();
      } else {
        onAdvance(currentIndex + 1);
      }
    }, delay);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isSkipped, active, total]);

  const progressPct = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <span className="text-lol-blue text-xs font-bold uppercase tracking-[0.2em]">{eyebrow}</span>
        <h3 className="font-display text-2xl md:text-3xl font-bold text-white uppercase mt-2">{title}</h3>
      </div>

      <div className="max-w-md mx-auto mb-10">
        <div className="flex items-center justify-between mb-2 text-xs uppercase tracking-wide">
          <span className="text-slate-500">
            Revelando {currentIndex + 1} de {total}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsSkipped(true);
              onFinished();
            }}
            className="text-slate-500 hover:text-lol-gold transition-colors underline underline-offset-2"
          >
            {skipCta}
          </button>
        </div>
        <div className="h-2 rounded-full overflow-hidden bg-black/40 border border-lol-border/50">
          <div
            className="h-full rounded-full bg-gradient-to-r from-lol-blue to-lol-gold transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div key={currentIndex} className="reveal-pop">
        {children}
      </div>

      <style>{`
        .reveal-pop {
          animation: revealPop 0.55s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes revealPop {
          0% { opacity: 0; transform: scale(0.92) translateY(16px); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .reveal-pop { animation: none; }
        }
      `}</style>
    </div>
  );
}
