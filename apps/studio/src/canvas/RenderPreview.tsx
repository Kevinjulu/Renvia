import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRenderJobsStore, type PreviewMode } from "./hooks/useRenderJobsStore";
import { useCanvasStore } from "./hooks/useCanvasStore";
import { useFittedBox, type Size } from "./hooks/useFittedBox";
import { hasSelection, maskStrokeFrom, startRenderEdit, useRenderEditStore, type RenderEditTool } from "./hooks/useRenderEditStore";
import { useApiClient } from "../lib/apiClient";
import { refreshAccount, useAccountStore } from "../lib/useAccountStore";
import { RenderEditSurface } from "./RenderEditSurface";
import { formatAspectRatio } from "./utils/aspectRatio";
import { WaitingProgress } from "../shell/panel/WaitingProgress";
import { useWheelZoom } from "./hooks/useWheelZoom";

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
  const [natural, setNatural] = useState<Size | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const box = useFittedBox(areaRef, natural);
  const dragging = useRef(false);

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

const EDIT_TOOLS: { id: RenderEditTool; label: string; key: string; icon: ReactNode }[] = [
  { id: "brush", label: "Brush", key: "B", icon: <><path d="M13.5 2.5 6 10" /><path d="M6 10c-1.7 0-3 1.3-3 3v.5h.5c1.7 0 3-1.3 3-3Z" /></> },
  { id: "eraser", label: "Eraser", key: "E", icon: <><path d="m9.5 3 3.5 3.5-6 6H4L2.5 11Z" /><path d="M7 13.5h6.5" /></> },
  { id: "rectangle", label: "Rectangle", key: "R", icon: <rect x="2.5" y="3.5" width="11" height="9" rx="1" strokeDasharray="2.2 1.8" /> },
  { id: "polygon", label: "Polygon", key: "P", icon: <path d="M4.5 2.5 13 5l-2 8.5-8.5-3Z" /> },
  { id: "magic", label: "Auto", key: "A", icon: <><path d="M8 1.5 9 5l3.5 1L9 7l-1 3.5L7 7 3.5 6 7 5Z" /><path d="M12.5 10.5 13 12l1.5.5L13 13l-.5 1.5-.5-1.5L10.5 12.5 12 12Z" /></> },
];

interface EditToolbarProps {
  onDone: () => void;
  onTextSelect: (text: string) => void;
  isSelecting: boolean;
  /** Reason automatic selection is unavailable, or null when it can be used. */
  autoDisabled: string | null;
}

function EditToolbar({ onDone, onTextSelect, isSelecting, autoDisabled }: EditToolbarProps) {
  const [text, setText] = useState("");
  const tool = useRenderEditStore((state) => state.tool);
  const setTool = useRenderEditStore((state) => state.setTool);
  const brushSize = useRenderEditStore((state) => state.brushSize);
  const setBrushSize = useRenderEditStore((state) => state.setBrushSize);
  const strokes = useRenderEditStore((state) => state.strokes);
  const undo = useRenderEditStore((state) => state.undo);
  const clearStrokes = useRenderEditStore((state) => state.clearStrokes);

  return (
    <div className="render-edit-toolbar">
      <div className="render-edit-tools" role="toolbar" aria-label="Selection tools">
        {EDIT_TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tool === item.id ? "is-active" : ""}
            aria-pressed={tool === item.id}
            disabled={item.id === "magic" && autoDisabled !== null}
            title={item.id === "magic" ? (autoDisabled ?? `Auto select — click an object (1 credit) (${item.key})`) : `${item.label} (${item.key})`}
            onClick={() => setTool(item.id)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">{item.icon}</svg>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {tool === "magic" ? (
        <form
          className="render-edit-auto"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) onTextSelect(text.trim());
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="or type what to select…"
            aria-label="Describe what to select"
            disabled={isSelecting}
          />
          <button type="submit" disabled={isSelecting || !text.trim()}>
            {isSelecting ? "Selecting…" : "Select"}
          </button>
        </form>
      ) : null}
      {(tool === "brush" || tool === "eraser") && (
        <label className="render-edit-size" title="Brush size">
          <span className="sr-only">Brush size</span>
          <i style={{ width: 6, height: 6 }} aria-hidden="true" />
          <input type="range" min={8} max={120} value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
          <i style={{ width: 12, height: 12 }} aria-hidden="true" />
        </label>
      )}
      <button type="button" className="render-preview-icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={strokes.length === 0} onClick={undo}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" /></svg>
      </button>
      <button type="button" className="render-edit-clear" disabled={strokes.length === 0} onClick={clearStrokes}>
        Clear
      </button>
      <button type="button" className="render-edit-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

/** Full-size view of a finished render, shown over the canvas; also where renders are edited. */
export function RenderPreview() {
  const jobs = useRenderJobsStore((state) => state.jobs);
  const previewJobId = useRenderJobsStore((state) => state.previewJobId);
  const mode = useRenderJobsStore((state) => state.previewMode);
  const setMode = useRenderJobsStore((state) => state.setPreviewMode);
  const setPreviewJob = useRenderJobsStore((state) => state.setPreviewJob);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const activeTab = useCanvasStore((state) => state.activeTab);
  const targetJobId = useRenderEditStore((state) => state.targetJobId);
  const strokes = useRenderEditStore((state) => state.strokes);
  const awaitingJobId = useRenderEditStore((state) => state.awaitingJobId);
  const stopEditing = useRenderEditStore((state) => state.stopEditing);
  const addStroke = useRenderEditStore((state) => state.addStroke);
  const apiClient = useApiClient();
  const [loaded, setLoaded] = useState(false);
  const me = useAccountStore((state) => state.me);
  const tool = useRenderEditStore((state) => state.tool);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectNotice, setSelectNotice] = useState<string | null>(null);
  const { zoom, transformOrigin, targetRef: imageRef, onWheel, resetZoom, isZoomed } = useWheelZoom<HTMLImageElement>(`${previewJobId}:${mode}`);
  const updateJob = useRenderJobsStore((state) => state.updateJob);
  const setAwaitingJob = useRenderEditStore((state) => state.setAwaitingJob);
  const [isCancelling, setIsCancelling] = useState(false);

  const viewable = jobs.filter((job) => job.status === "succeeded" && job.resultImageUrl);
  const index = viewable.findIndex((job) => job.id === previewJobId);
  const job = (index >= 0 ? viewable[index] : undefined) ?? null;
  const isEditing = job !== null && targetJobId === job.id;

  useEffect(() => setLoaded(false), [job?.resultImageUrl, mode]);

  // Picking another view tab or filmstrip slot means the user wants the canvas back.
  const firstViewId = useRef(activeViewId);
  useEffect(() => {
    if (activeViewId !== firstViewId.current) {
      firstViewId.current = activeViewId;
      useRenderJobsStore.getState().setPreviewJob(null);
    }
  }, [activeViewId]);

  // Editing a render only lasts while it's the one on screen and the Edit tab is open.
  useEffect(() => {
    if (targetJobId && (previewJobId !== targetJobId || activeTab !== "edit")) stopEditing();
  }, [targetJobId, previewJobId, activeTab, stopEditing]);

  // When an edit queued from here finishes, show it against the render it came from.
  const awaited = jobs.find((item) => item.id === awaitingJobId);
  const awaiting = awaited && (awaited.status === "pending" || awaited.status === "processing") ? awaited : null;
  useEffect(() => {
    if (!awaited || (awaited.status !== "succeeded" && awaited.status !== "failed")) return;
    useRenderEditStore.getState().setAwaitingJob(null);
    if (awaited.status !== "succeeded" || !awaited.resultImageUrl || !previewJobId) return;
    const shown = jobs.find((item) => item.id === previewJobId);
    if (shown?.resultImageUrl === awaited.sourceImageUrl) {
      stopEditing();
      setPreviewJob(awaited.id, "compare");
    }
  }, [awaited, jobs, previewJobId, setPreviewJob, stopEditing]);

  useEffect(() => {
    if (!job || isEditing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape") setPreviewJob(null);
      else if (event.key === "ArrowLeft" && index > 0) setPreviewJob(viewable[index - 1]!.id);
      else if (event.key === "ArrowRight" && index < viewable.length - 1) setPreviewJob(viewable[index + 1]!.id);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [job, isEditing, index, viewable, setPreviewJob]);

  const runAutoSelect = async (request: { prompt?: string; point?: { x: number; y: number } }) => {
    if (!job?.resultImageUrl || isSelecting) return;
    setIsSelecting(true);
    setSelectNotice(null);
    try {
      const result = await apiClient.createSegmentation({ imageUrl: job.resultImageUrl, ...request });
      void refreshAccount(apiClient.getMe);
      if (!result.objectCount || !result.maskDataUrl) {
        setSelectNotice("Nothing matched — your credit was refunded. Try another spot or paint it by hand.");
        return;
      }
      addStroke(await maskStrokeFrom(result.maskDataUrl));
      setSelectNotice(
        result.objectCount === 1 ? "Selected 1 area — erase or paint to adjust." : `Selected ${result.objectCount} areas — erase or paint to adjust.`,
      );
    } catch {
      setSelectNotice("Automatic selection failed. Try again, or paint the area by hand.");
    } finally {
      setIsSelecting(false);
    }
  };

  const handleCancelAwaiting = async () => {
    if (!awaiting || isCancelling) return;
    setIsCancelling(true);
    try {
      const { job: cancelled } = await apiClient.cancelRender(awaiting.id);
      updateJob(cancelled.id, cancelled);
      void refreshAccount(apiClient.getMe);
      setAwaitingJob(null);
    } catch {
      // Left processing — the button stays up so the user can try again.
    } finally {
      setIsCancelling(false);
    }
  };

  if (!job?.resultImageUrl) return null;

  const title = [job.settings?.edit ? "Edit" : "Render", job.viewLabel].filter(Boolean).join(" · ");
  const shownUrl = mode === "source" ? job.sourceImageUrl : job.resultImageUrl;
  const parent = job.settings?.edit ? jobs.find((item) => item.resultImageUrl === job.sourceImageUrl) : undefined;
  const selected = hasSelection(strokes);
  const isAdmin = me?.role === "admin";
  const autoDisabled = (() => {
    if (me?.maintenanceSegments && !isAdmin) return me.maintenanceMessage?.trim() || "Automatic selection is paused for maintenance.";
    if (me && !isAdmin && me.creditBalance < 1) return "Out of credits — paint the area by hand instead.";
    return null;
  })();

  return (
    <div className={`render-preview ${isEditing ? "is-editing" : ""}`} role="dialog" aria-label={`${title} ${isEditing ? "editor" : "preview"}`}>
      <header className="render-preview-bar">
        <button type="button" className="render-preview-back" onClick={() => setPreviewJob(null)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
          Back to canvas
        </button>
        <div className="render-preview-title">
          <strong>{isEditing ? `Editing ${title.toLowerCase()}` : title}</strong>
          {!isEditing && viewable.length > 1 && <span>{index + 1} of {viewable.length}</span>}
          {!isEditing && parent && (
            <button type="button" className="render-preview-parent" onClick={() => setPreviewJob(parent.id)}>
              from an earlier render
            </button>
          )}
        </div>
        {isEditing ? (
          <EditToolbar
            onDone={stopEditing}
            onTextSelect={(prompt) => void runAutoSelect({ prompt })}
            isSelecting={isSelecting}
            autoDisabled={autoDisabled}
          />
        ) : (
          <div className="render-preview-actions">
            <div className="render-preview-modes" role="tablist" aria-label="View">
              {(["render", "compare", "source"] as const satisfies readonly PreviewMode[]).map((item) => (
                <button key={item} type="button" role="tab" aria-selected={mode === item} className={mode === item ? "is-active" : ""} onClick={() => setMode(item)}>
                  {item === "render" ? "Render" : item === "compare" ? "Compare" : "Source"}
                </button>
              ))}
            </div>
            <button type="button" className="render-preview-edit" onClick={() => startRenderEdit(job.id)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3Z" /></svg>
              Edit
            </button>
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
        )}
      </header>

      <div className={`render-preview-stage ${!isEditing && mode !== "compare" ? "is-zoomable" : ""}`} onWheel={!isEditing && mode !== "compare" ? onWheel : undefined}>
        {!isEditing && index > 0 && (
          <button type="button" className="render-preview-nav is-prev" aria-label="Previous render" onClick={() => setPreviewJob(viewable[index - 1]!.id)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
          </button>
        )}
        {isEditing ? (
          <RenderEditSurface
            imageUrl={job.resultImageUrl}
            onExit={stopEditing}
            onMagicSelect={(point) => void runAutoSelect({ point })}
            isSelecting={isSelecting}
          />
        ) : mode === "compare" ? (
          <CompareView key={job.id} renderUrl={job.resultImageUrl} sourceUrl={job.sourceImageUrl} />
        ) : (
          <img
            key={shownUrl}
            ref={imageRef}
            src={shownUrl}
            alt={mode === "source" ? "Source image" : title}
            className={`render-preview-image ${loaded ? "is-loaded" : ""}`}
            style={{ transform: `scale(${zoom})`, transformOrigin }}
            onLoad={() => setLoaded(true)}
            draggable={false}
          />
        )}
        {!isEditing && mode !== "compare" && !loaded && <span className="render-preview-spinner" aria-label="Loading image" />}
        {!isEditing && mode !== "compare" && isZoomed && (
          <button type="button" className="render-zoom-badge" onClick={resetZoom}>
            {Math.round(zoom * 100)}% · Reset
          </button>
        )}
        {!isEditing && index < viewable.length - 1 && (
          <button type="button" className="render-preview-nav is-next" aria-label="Next render" onClick={() => setPreviewJob(viewable[index + 1]!.id)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
          </button>
        )}
      </div>

      {awaiting ? (
        <div className="render-preview-waiting">
          <WaitingProgress
            job={awaiting}
            label={awaiting.status === "pending" ? "Queued" : "Applying edit"}
            onCancel={handleCancelAwaiting}
            isCancelling={isCancelling}
          />
        </div>
      ) : isEditing ? (
        <footer className="render-preview-footer is-hint">
          <p>
            {selectNotice
              ? selectNotice
              : tool === "magic"
                ? "Click the part you want to change, or type what to select. Each automatic selection costs 1 credit; painting is free."
                : selected
                ? "Only the highlighted area will change. Describe the change in the Edit panel, add a reference if you like, then Apply edit."
                : "Paint over the part you want to change, like a door or window, or skip it to edit the whole render. Describe the change in the Edit panel."}
          </p>
          {isSelecting && <span className="render-edit-pending">Finding that area…</span>}
        </footer>
      ) : (
        (job.prompt || job.style || formatAspectRatio(job.aspectRatio)) && (
          <footer className="render-preview-footer">
            {job.prompt && <p title={job.prompt}>{job.prompt}</p>}
            <div>
              {[job.style, formatAspectRatio(job.aspectRatio)].filter(Boolean).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </footer>
        )
      )}
    </div>
  );
}
