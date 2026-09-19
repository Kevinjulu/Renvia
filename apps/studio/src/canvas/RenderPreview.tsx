import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRenderJobsStore } from "./hooks/useRenderJobsStore";
import { useCanvasStore } from "./hooks/useCanvasStore";

type Mode = "render" | "compare" | "source";

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

/** Before/after slider — the source is stretched over the render's box so the two line up. */
function CompareView({ renderUrl, sourceUrl }: { renderUrl: string; sourceUrl: string }) {
  const [split, setSplit] = useState(50);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Largest box with the render's aspect ratio that fits the stage (never upscaled).
  const box = (() => {
    if (!natural || !area) return null;
    const scale = Math.min(area.width / natural.width, area.height / natural.height, 1);
    return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) };
  })();

  const moveTo = (clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTo(event.clientX);
  };

  return (
    <div ref={areaRef} className="render-preview-compare-area">
      <img
        src={renderUrl}
        alt=""
        hidden
        onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      />
      {box ? (
        <div
          ref={boxRef}
          className="render-preview-compare"
          style={box}
          onPointerDown={onPointerDown}
          onPointerMove={(event) => dragging.current && moveTo(event.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <img src={renderUrl} alt="Render" draggable={false} />
          <img src={sourceUrl} alt="Source" draggable={false} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
          <span className="render-preview-compare-tag is-before">Before</span>
          <span className="render-preview-compare-tag is-after">After</span>
          <div
            className="render-preview-compare-handle"
            style={{ left: `${split}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Compare before and after"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                event.stopPropagation();
                setSplit((value) => Math.min(100, Math.max(0, value + (event.key === "ArrowLeft" ? -5 : 5))));
              }
            }}
          >
            <span aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="M6 4 2 8l4 4M10 4l4 4-4 4" /></svg>
            </span>
          </div>
        </div>
      ) : (
        <span className="render-preview-spinner" aria-label="Loading images" />
      )}
    </div>
  );
}

/** Full-size view of a finished render, shown over the canvas when a render is clicked in the results panel. */
export function RenderPreview() {
  const jobs = useRenderJobsStore((state) => state.jobs);
  const previewJobId = useRenderJobsStore((state) => state.previewJobId);
  const setPreviewJob = useRenderJobsStore((state) => state.setPreviewJob);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const [mode, setMode] = useState<Mode>("render");
  const [loaded, setLoaded] = useState(false);

  const viewable = jobs.filter((job) => job.status === "succeeded" && job.resultImageUrl);
  const index = viewable.findIndex((job) => job.id === previewJobId);
  const job = index >= 0 ? viewable[index] : null;

  useEffect(() => setLoaded(false), [job?.resultImageUrl, mode]);

  // Picking another view tab or filmstrip slot means the user wants the canvas back.
  const firstViewId = useRef(activeViewId);
  useEffect(() => {
    if (activeViewId !== firstViewId.current) {
      firstViewId.current = activeViewId;
      useRenderJobsStore.getState().setPreviewJob(null);
    }
  }, [activeViewId]);

  useEffect(() => {
    if (!job) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape") setPreviewJob(null);
      else if (event.key === "ArrowLeft" && index > 0) setPreviewJob(viewable[index - 1]!.id);
      else if (event.key === "ArrowRight" && index < viewable.length - 1) setPreviewJob(viewable[index + 1]!.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [job, index, viewable, setPreviewJob]);

  if (!job?.resultImageUrl) return null;

  const title = [job.settings?.edit ? "Edit" : "Render", job.viewLabel].filter(Boolean).join(" · ");
  const shownUrl = mode === "source" ? job.sourceImageUrl : job.resultImageUrl;

  return (
    <div className="render-preview" role="dialog" aria-label={`${title} preview`}>
      <header className="render-preview-bar">
        <button type="button" className="render-preview-back" onClick={() => setPreviewJob(null)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
          Back to canvas
        </button>
        <div className="render-preview-title">
          <strong>{title}</strong>
          {viewable.length > 1 && <span>{index + 1} of {viewable.length}</span>}
        </div>
        <div className="render-preview-actions">
          <div className="render-preview-modes" role="tablist" aria-label="View">
            {(["render", "compare", "source"] as const).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={mode === item} className={mode === item ? "is-active" : ""} onClick={() => setMode(item)}>
                {item === "render" ? "Render" : item === "compare" ? "Compare" : "Source"}
              </button>
            ))}
          </div>
          <button type="button" className="render-preview-icon" title="Download" aria-label="Download render" onClick={() => downloadImage(job.resultImageUrl!)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" /></svg>
          </button>
          <button type="button" className="render-preview-icon" title="Open original in a new tab" aria-label="Open original in a new tab" onClick={() => window.open(shownUrl, "_blank", "noopener,noreferrer")}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></svg>
          </button>
          <button type="button" className="render-preview-icon" title="Close (Esc)" aria-label="Close preview" onClick={() => setPreviewJob(null)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </div>
      </header>

      <div className="render-preview-stage">
        {index > 0 && (
          <button type="button" className="render-preview-nav is-prev" aria-label="Previous render" onClick={() => setPreviewJob(viewable[index - 1]!.id)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
          </button>
        )}
        {mode === "compare" ? (
          <CompareView key={job.id} renderUrl={job.resultImageUrl} sourceUrl={job.sourceImageUrl} />
        ) : (
          <img key={shownUrl} src={shownUrl} alt={mode === "source" ? "Source image" : title} className={`render-preview-image ${loaded ? "is-loaded" : ""}`} onLoad={() => setLoaded(true)} draggable={false} />
        )}
        {mode !== "compare" && !loaded && <span className="render-preview-spinner" aria-label="Loading image" />}
        {index < viewable.length - 1 && (
          <button type="button" className="render-preview-nav is-next" aria-label="Next render" onClick={() => setPreviewJob(viewable[index + 1]!.id)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
          </button>
        )}
      </div>

      {(job.prompt || job.style || job.resolution) && (
        <footer className="render-preview-footer">
          {job.prompt && <p title={job.prompt}>{job.prompt}</p>}
          <div>
            {[job.style, job.resolution].filter(Boolean).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
