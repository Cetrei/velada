export function FileInput({
  fileName,
  hasExisting,
  accept,
  capture,
  onChange
}: {
  fileName: string | null;
  hasExisting: boolean;
  accept: string;
  capture?: "environment" | "user";
  onChange: (fileList: FileList | null) => void;
}) {
  const statusText = fileName ?? (hasExisting ? "Imagen ya cargada" : "Ningun archivo seleccionado");
  const statusClass = fileName || hasExisting ? "file-input-status-set" : "file-input-status-empty";

  return (
    <div className="file-input">
      <span className="file-input-button">Elegir archivo</span>
      <span className={`file-input-status ${statusClass}`}>{statusText}</span>
      <input
        type="file"
        accept={accept}
        capture={capture}
        onChange={(e) => onChange(e.target.files)}
        className="file-input-native"
        aria-label="Elegir archivo"
      />

      <style>{`
        .file-input {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
          background: #0A1428;
          border: 1px solid rgba(200, 170, 110, 0.2);
          border-radius: 4px;
          overflow: hidden;
        }

        .file-input-button {
          flex-shrink: 0;
          padding: 0.65rem 1rem;
          background: #C8AA6E;
          color: black;
          font-weight: 700;
          text-transform: uppercase;
          font-size: 0.75rem;
          white-space: nowrap;
        }

        .file-input-status {
          flex: 1;
          min-width: 0;
          padding: 0.65rem 0.75rem;
          font-size: 0.85rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-input-status-set {
          color: white;
        }

        .file-input-status-empty {
          color: #6b7280;
        }

        .file-input-native {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
