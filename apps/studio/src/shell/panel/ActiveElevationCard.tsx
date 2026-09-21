import { useRef, useState } from "react";
import { useElevationUpload } from "../../canvas/hooks/useElevationUpload";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { filledBuildingViews, isDefaultViewId, nodeForView, renderableBuildingViews } from "../../canvas/buildingViews";
import { viewImage } from "../../canvas/utils/viewImage";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * The elevation selected on the canvas, and nothing else — the tabs and filmstrip under the
 * canvas already list every side, so the panel only needs the one being worked on.
 */
export function ActiveElevationCard() {
  const views = useCanvasStore((state) => state.views);
  const nodes = useCanvasStore((state) => state.nodes);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const skippedViewIds = useCanvasStore((state) => state.skippedViewIds);
  const toggleViewSkipped = useCanvasStore((state) => state.toggleViewSkipped);
  const { uploadToView, clearViewImage, removeView, isUploading, uploadingViewId } = useElevationUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const index = Math.max(0, views.findIndex((view) => view.id === activeViewId));
  const view = views[index];
  if (!view) return null;

  const node = nodeForView(nodes, view.id);
  const skipped = Boolean(node) && skippedViewIds.includes(view.id);
  const uploading = uploadingViewId === view.id;
  const filledCount = filledBuildingViews(views, nodes).length;
  const renderCount = renderableBuildingViews(views, nodes, skippedViewIds).length;
  const removesSlot = !isDefaultViewId(view.id);

  const upload = (file: File | undefined) => {
    if (file && ACCEPTED_TYPES.includes(file.type) && !isUploading) void uploadToView(view, file);
  };

  const summary =
    filledCount === 0
      ? "Nothing uploaded yet"
      : `${renderCount} of ${filledCount} uploaded ${renderCount === 1 ? "elevation" : "elevations"} will render`;

  return (
    <section
      className={`cp-elevation ${node ? "is-filled" : "is-empty"} ${skipped ? "is-skipped" : ""} ${isDragOver ? "is-dragover" : ""}`}
      data-guide="control.uploads"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragOver(false);
        upload(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <button
        type="button"
        className="cp-elevation-thumb"
        onClick={() => (node ? viewImage(node.imageUrl, view.label) : inputRef.current?.click())}
        disabled={!node && isUploading}
        title={node ? "View full size" : `Upload the ${view.label.toLowerCase()}`}
      >
        {node ? (
          <img src={node.imageUrl} alt="" />
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" />
          </svg>
        )}
        {uploading && <span className="cp-elevation-busy" aria-hidden="true" />}
      </button>

      <div className="cp-elevation-body">
        <p className="cp-elevation-eyebrow">
          Elevation {index + 1} of {views.length}
        </p>
        <strong>{view.label}</strong>
        {node ? (
          <div className="cp-elevation-actions">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={isUploading}>
              {uploading ? "Uploading…" : "Replace"}
            </button>
            <button
              type="button"
              onClick={() => void (removesSlot ? removeView(view.id) : clearViewImage(view.id))}
              disabled={isUploading}
              title={removesSlot ? `Remove ${view.label} and its image` : `Remove this image; the ${view.label} slot stays empty`}
            >
              Remove
            </button>
          </div>
        ) : (
          <button type="button" className="cp-elevation-upload" onClick={() => inputRef.current?.click()} disabled={isUploading}>
            {uploading ? "Uploading…" : "Upload or drop an image"}
          </button>
        )}
        <small>{summary}</small>
      </div>

      {node && (
        <label className="cp-switch" title={skipped ? "Skipped — turn on to render it" : "Will render — turn off to skip"}>
          <input type="checkbox" checked={!skipped} onChange={() => toggleViewSkipped(view.id)} aria-label={`Render ${view.label}`} />
          <span aria-hidden="true" />
        </label>
      )}
    </section>
  );
}
