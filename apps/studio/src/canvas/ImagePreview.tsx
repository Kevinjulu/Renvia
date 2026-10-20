import { useEffect, useRef, useState } from "react";
import { useRenderJobsStore } from "./hooks/useRenderJobsStore";
import { useCanvasStore } from "./hooks/useCanvasStore";
import { useDownloadDialogStore } from "./hooks/useDownloadDialogStore";
import { isSameImage } from "./utils/sameImage";
import { useFocusTrap } from "../lib/useFocusTrap";
import { showStudioNotice } from "../shell/StudioNotice";

/**
 * Saves the image in place. Images are served from the API's origin, where a plain link's
 * download attribute is ignored and the browser opens a new tab instead, so fetch it first.
 */
async function downloadImage(url: string, title: string) {
  try {
    // no-store: a copy cached from the <img> on screen has no CORS headers (see DownloadDialog).
    const response = await fetch(url, { mode: "cors", cache: "no-store" });
    if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ramah-studio-image"}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    showStudioNotice("Download failed. Try again.");
  }
}

/** The render whose result this image is, if any. */
function renderJobFor(url: string) {
  return useRenderJobsStore.getState().jobs.find((job) => isSameImage(job.resultImageUrl, url)) ?? null;
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
  const dialogRef = useFocusTrap<HTMLDivElement>(Boolean(image && !previewJobId), ".render-preview-back", { contain: false });

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
    <div ref={dialogRef} className="render-preview" role="dialog" aria-label={`${image.title} preview`}>
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
            onClick={() => {
              // A render shown here (e.g. one set as the base elevation) gets the full download options.
              const job = renderJobFor(image.url);
              if (job) useDownloadDialogStore.getState().open(job.id);
              else void downloadImage(image.url, image.title);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" /></svg>
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
