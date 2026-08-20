import { rankIconPath } from "@velada/core";
import type { ParticipantStat } from "@velada/core";

export interface PlayerCardData {
  name: string;
  nickname: string;
  mainRole: string;
  favChampion: string;
  lolRank?: string | null;
  photo?: string | null;
  banner?: string | null;
  stats?: ParticipantStat[];
}

interface PlayerCardProps {
  data: PlayerCardData;
  className?: string;
}

function fallbackImg(nickname: string): string {
  return `https://placehold.co/600x800/0A1428/C8AA6E?text=${encodeURIComponent(nickname || "?")}`;
}

export default function PlayerCard({ data, className = "" }: PlayerCardProps) {
  const bgImage = data.banner || data.photo || fallbackImg(data.nickname);
  const avatarImage = data.photo || null;
  const visibleStats = (data.stats ?? []).filter((s) => s.label.trim().length > 0).slice(0, 4);

  return (
    <div className={`player-card ${className}`}>
      <img src={bgImage} alt={data.name || "Preview"} className="player-card-bg" decoding="async" />
      <div className="player-card-scrim-top" />
      <div className="player-card-scrim-bottom" />

      <div className="player-card-header">
        <span className="player-card-role">{data.mainRole || "—"}</span>

        <div className="player-card-name-row">
          <div className="player-card-identity">
            {avatarImage && (
              <img src={avatarImage} alt="" className="player-card-avatar" />
            )}
            <div className="player-card-name-block">
              <h3 className="player-card-name">{data.name || "Nombre del peleador"}</h3>
              <p className="player-card-nickname">"{data.nickname || "apodo"}"</p>
            </div>
          </div>
          {data.lolRank && (
            <span className="player-card-rank">
              <img
                src={rankIconPath(data.lolRank)}
                alt=""
                className="player-card-rank-icon"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              {data.lolRank}
            </span>
          )}
        </div>
      </div>

      <div className="player-card-footer">
        {data.favChampion && <p className="player-card-champion">{data.favChampion}</p>}

        {visibleStats.length > 0 && (
          <div className="player-card-stats">
            {visibleStats.map((stat) => (
              <div key={stat.label} className="player-card-stat">
                <div className="player-card-stat-label">
                  <span>{stat.label}</span>
                  <span>{stat.value}</span>
                </div>
                <div className="player-card-stat-track">
                  <div className="player-card-stat-fill" style={{ width: `${stat.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .player-card {
          position: relative;
          width: 100%;
          aspect-ratio: 4 / 5;
          overflow: hidden;
          background-color: #0A1428;
          border: 1px solid rgba(200, 170, 110, 0.3);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          font-family: 'Spiegel', 'Inter', sans-serif;
        }

        .player-card-bg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center top;
        }

        /* Scrim superior: oscurece la franja de arriba de la imagen lo
           suficiente para que el rol/nombre/apodo/rango de
           .player-card-header se lean bien, sin taparla del todo -- solo
           se degrada hacia abajo (no cubre el resto de la foto). */
        .player-card-scrim-top {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(10, 20, 40, 0.9) 0%,
            rgba(10, 20, 40, 0.55) 45%,
            rgba(10, 20, 40, 0.05) 75%,
            transparent 100%
          );
        }

        /* Scrim inferior: mismo criterio pero para el bloque de
           performance + stats custom que ahora vive abajo -- reemplaza al
           unico .player-card-scrim que cubria toda la carta de punta a
           punta cuando todo el contenido vivia anclado al fondo. */
        .player-card-scrim-bottom {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to top,
            rgba(10, 20, 40, 0.96) 0%,
            rgba(10, 20, 40, 0.55) 38%,
            rgba(10, 20, 40, 0.05) 62%,
            transparent 100%
          );
        }

        .player-card-header {
          position: relative;
          z-index: 2;
          padding: clamp(10px, 4%, 20px);
          padding-bottom: 0;
          display: flex;
          flex-direction: column;
          gap: clamp(6px, 2%, 10px);
        }

        .player-card-footer {
          position: relative;
          z-index: 2;
          padding: clamp(10px, 4%, 20px);
          padding-top: 0;
        }

        .player-card-role {
          display: inline-block;
          width: fit-content;
          padding: 3px 10px;
          background: rgba(10, 20, 40, 0.75);
          border: 1px solid #C8AA6E;
          color: #C8AA6E;
          font-size: clamp(0.55rem, 1.6cqw, 0.7rem);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .player-card-name-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }

        .player-card-identity {
          display: flex;
          align-items: center;
          gap: clamp(6px, 2.5cqw, 10px);
          min-width: 0;
        }

        .player-card-avatar {
          flex-shrink: 0;
          width: clamp(32px, 12cqw, 48px);
          height: clamp(32px, 12cqw, 48px);
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid #C8AA6E;
          box-shadow: 0 2px 8px rgba(0,0,0,0.6);
          background-color: #0A1428;
        }

        .player-card-name-block {
          min-width: 0;
        }

        .player-card-name {
          margin: 0;
          font-family: 'Oswald', 'Beaufort for LOL', sans-serif;
          font-weight: 700;
          font-size: clamp(1rem, 5cqw, 1.6rem);
          color: white;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          line-height: 1.1;
          text-shadow: 0 2px 6px rgba(0,0,0,0.8);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .player-card-rank {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: clamp(0.6rem, 2cqw, 0.8rem);
          font-weight: 700;
          color: #f0e6d2;
          white-space: nowrap;
          text-shadow: 0 1px 4px rgba(0,0,0,0.8);
        }

        .player-card-rank-icon {
          width: clamp(14px, 4cqw, 20px);
          height: clamp(14px, 4cqw, 20px);
          object-fit: contain;
        }

        .player-card-nickname {
          margin: 2px 0 0;
          color: #4FC3E8;
          font-style: italic;
          font-size: clamp(0.7rem, 2.4cqw, 0.9rem);
          text-shadow: 0 1px 4px rgba(0,0,0,0.8);
        }

        .player-card-champion {
          margin: 0;
          color: #a09b8c;
          font-size: clamp(0.6rem, 2cqw, 0.75rem);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .player-card-stats {
          margin-top: clamp(8px, 3%, 14px);
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .player-card-stat-label {
          display: flex;
          justify-content: space-between;
          font-size: clamp(0.5rem, 1.6cqw, 0.65rem);
          text-transform: uppercase;
          color: #a09b8c;
          margin-bottom: 2px;
        }

        .player-card-stat-track {
          height: 4px;
          background: rgba(0,0,0,0.5);
          border: 1px solid rgba(200, 170, 110, 0.25);
          border-radius: 2px;
          overflow: hidden;
        }

        .player-card-stat-fill {
          height: 100%;
          background: linear-gradient(to right, #C8AA6E, #f0e6d2);
        }
      `}</style>
    </div>
  );
}