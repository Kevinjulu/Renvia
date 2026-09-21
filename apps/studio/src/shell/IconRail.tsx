import { useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useElevationUpload } from "../canvas/hooks/useElevationUpload";
import { useUploadProgressStore } from "../canvas/hooks/useUploadProgressStore";
import { GuideButton } from "../guide/GuideButton";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// One wave period is 60 wide; the path spans two so sliding it by half loops seamlessly.
const WAVE_PATH = "M0 6 Q15 0 30 6 T60 6 T90 6 T120 6 V14 H0 Z";

function UploadButton() {
  const { uploadFiles } = useElevationUpload();
  const status = useUploadProgressStore((state) => state.status);
  const progress = useUploadProgressStore((state) => state.progress);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const busy = status === "uploading";
  const percent = Math.round(progress * 100);

  const start = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((file) => ACCEPTED_TYPES.includes(file.type));
    if (files.length && !busy) void uploadFiles(files);
  };

  const label =
    status === "uploading" ? `Uploading, ${percent}%` : status === "done" ? "Upload complete" : status === "error" ? "Upload failed" : "Upload elevation";

  return <>
    <button
      type="button"
      className={`rail-upload is-${status} ${isDragOver ? "is-dragover" : ""}`}
      style={{ "--fill": status === "idle" ? 0 : progress } as CSSProperties}
      data-label={status === "idle" ? "Upload elevation" : label}
      aria-label={label}
      aria-busy={busy}
      disabled={busy}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setIsDragOver(false); start(event.dataTransfer.files); }}
    >
      <span className="rail-upload-water" aria-hidden="true">
        <svg className="is-back" viewBox="0 0 120 14" preserveAspectRatio="none"><path d={WAVE_PATH} /></svg>
        <svg className="is-front" viewBox="0 0 120 14" preserveAspectRatio="none"><path d={WAVE_PATH} /></svg>
      </span>
      <span className="rail-upload-label" aria-hidden="true">
        {status === "uploading" ? `${percent}%` : status === "done" ? "✓" : status === "error" ? "!" : <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>}
      </span>
    </button>
    <span className="sr-only" role="status">{status === "idle" ? "" : label}</span>
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_TYPES.join(",")}
      multiple
      className="hidden"
      onChange={(event) => { start(event.target.files); event.target.value = ""; }}
    />
  </>;
}

export function IconRail() {
  return <aside className="studio-rail" aria-label="Studio tools">
    <Link to="/dashboard" className="rail-back" data-label="Back to projects" aria-label="Back to projects">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </Link>
    <div className="rail-bottom">
      <UploadButton />
      <GuideButton />
    </div>
  </aside>;
}
