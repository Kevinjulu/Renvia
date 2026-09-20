import { useEffect, useRef, useState } from "react";
import { useRenderJobsStore } from "./hooks/useRenderJobsStore";
import { useCanvasStore } from "./hooks/useCanvasStore";

function downloadImage(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Full-size view of any image that isn't a render job — a source photo, a reference, an
 * uploaded view. Shares the render viewer's chrome so the canvas area behaves the same
 * whichever thumbnail was clicked.
 */
export function ImagePreview() {
  const image = useRenderJobsStore((state) => state.previewImage);
  const previewJobId = useRenderJobsStore((state) => state.previewJobId);
  const setPreviewImage = useRenderJobsStore((state) => state.setPreviewImage);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const [loaded, setLoaded] = useState(false);

  // Picking another view tab means the user wants the canvas back.
  const firstViewId = useRef(activeViewId);
  useEffect(() => {
    if (activeViewId !== firstViewId.current) {
      firstViewId.current = activeViewId;
      useRenderJobsStore.getState().setPreviewImage(null);
    }
  }, [activeViewId]);

  const url = image?.url ?? null;
  useEffect(() => setLoaded(false), [url]);

  useEffect(() => {
    if (!url) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape") setPreviewImage(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [url, setPreviewImage]);

  if (!image || previewJobId) return null;

  return (
    <div className="render-preview" role="dialog" aria-label={`${image.title} preview`}>
      <header className="render-preview-bar">
        <button type="button" className="render-preview-back" onClick={() => setPreviewImage(null)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
          Back to canvas
        </button>
        <div className="render-preview-title">
          <strong>{image.title}</strong>
          {image.caption && <span>{image.caption}</span>}
        </div>
        <div className="render-preview-actions">
          <button
            type="button"
            className="render-preview-icon"
            title="Download"
            aria-label="Download image"
            onClick={() => downloadImage(image.url)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" /></svg>
          </button>
          <button
            type="button"
            className="render-preview-icon"
            title="Open original in a new tab"
            aria-label="Open original in a new tab"
            onClick={() => window.open(image.url, "_blank", "noopener,noreferrer")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></svg>
          </button>
          <button
            type="button"
            className="render-preview-icon"
            title="Close (Esc)"
            aria-label="Close preview"
            onClick={() => setPreviewImage(null)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      </header>

      <div className="render-preview-stage">
        <img
          key={image.url}
          src={image.url}
          alt={image.title}
          className={`render-preview-image ${loaded ? "is-loaded" : ""}`}
          onLoad={() => setLoaded(true)}
          draggable={false}
        />
        {!loaded && <span className="render-preview-spinner" aria-label="Loading image" />}
      </div>
    </div>
  );
}
