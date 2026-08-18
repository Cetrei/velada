import { useEffect, useState } from "react";

interface CountdownProps {
  targetIso: string;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function computeTimeLeft(targetIso: string): TimeLeft {
  const diff = new Date(targetIso).getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000)
  };
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export default function Countdown({ targetIso }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => computeTimeLeft(targetIso));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(computeTimeLeft(targetIso));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetIso]);

  const units: Array<{ label: string; value: number; accent?: boolean }> = [
    { label: "Días", value: timeLeft.days },
    { label: "Horas", value: timeLeft.hours },
    { label: "Mins", value: timeLeft.minutes },
    { label: "Segs", value: timeLeft.seconds, accent: true }
  ];

  return (
    <div className="flex items-center justify-center gap-4 md:gap-8 mb-12">
      {units.map((unit, index) => (
        <div key={unit.label} className="flex items-center gap-4 md:gap-8">
          <div className="flex flex-col items-center">
            <span
              className={`font-display text-4xl md:text-6xl font-bold mb-1 ${
                unit.accent ? "text-lol-blue" : "text-white"
              }`}
            >
              {pad(unit.value)}
            </span>
            <span className="text-xs md:text-sm text-lol-gold uppercase tracking-wider font-bold">
              {unit.label}
            </span>
          </div>
          {index < units.length - 1 && (
            <span className="text-3xl text-lol-border mb-6">:</span>
          )}
        </div>
      ))}
    </div>
  );
}
