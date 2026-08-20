import { useEffect, useRef, useState } from "react";

export interface InfoModalProps {
  /** Texto accesible del boton "!" (ej. "Como se calcula el Performance Rank"). */
  label: string;
  title: string;
  children: React.ReactNode;
  /** Tamano del icono en px -- mas chico para usarlo inline junto a una barra individual. */
  iconSize?: number;
}

export default function InfoModal({ label, title, children, iconSize = 15 }: InfoModalProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleClickOutside(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="info-modal-trigger"
        style={{ width: iconSize, height: iconSize, fontSize: iconSize * 0.68 }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={label}
        aria-haspopup="dialog"
      >
        !
      </button>

      {open && (
        <div className="info-modal-overlay" role="presentation">
          <div className="info-modal-dialog" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
            <div className="info-modal-header">
              <h4 className="info-modal-title">{title}</h4>
              <button
                type="button"
                className="info-modal-close"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <div className="info-modal-body">{children}</div>
          </div>
        </div>
      )}

      <style>{`
        .info-modal-trigger {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border-radius: 50%;
          border: 1px solid rgba(200, 170, 110, 0.4);
          background: rgba(200, 170, 110, 0.08);
          color: #C8AA6E;
          font-weight: 700;
          font-style: italic;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .info-modal-trigger:hover {
          background: rgba(200, 170, 110, 0.2);
          border-color: #C8AA6E;
        }

        .info-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 100;
        }

        .info-modal-dialog {
          background: #0A1428;
          border: 1px solid rgba(200, 170, 110, 0.35);
          border-radius: 6px;
          max-width: 440px;
          width: 100%;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        }

        .info-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 18px;
          border-bottom: 1px solid rgba(200, 170, 110, 0.2);
          position: sticky;
          top: 0;
          background: #0A1428;
        }

        .info-modal-title {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 700;
          color: #C8AA6E;
        }

        .info-modal-close {
          flex-shrink: 0;
          background: none;
          border: none;
          color: #a09b8c;
          font-size: 0.9rem;
          cursor: pointer;
          padding: 4px;
          line-height: 1;
        }

        .info-modal-close:hover {
          color: #fff;
        }

        .info-modal-body {
          padding: 16px 18px 20px;
          font-size: 0.82rem;
          line-height: 1.55;
          color: #d7d2c4;
        }

        .info-modal-body p {
          margin: 0 0 10px;
        }

        .info-modal-body p:last-child {
          margin-bottom: 0;
        }

        .info-modal-body ul {
          margin: 0 0 10px;
          padding-left: 18px;
        }

        .info-modal-body li {
          margin-bottom: 6px;
        }

        .info-modal-body li:last-child {
          margin-bottom: 0;
        }

        .info-modal-formula {
          font-size: 0.78rem;
          font-style: italic;
          color: #C8AA6E;
          border-left: 2px solid rgba(200, 170, 110, 0.4);
          padding-left: 10px;
          margin: 0 0 10px;
        }
      `}</style>
    </>
  );
}
