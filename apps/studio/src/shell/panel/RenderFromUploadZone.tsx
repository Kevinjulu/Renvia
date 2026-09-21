import { AddViewMenu } from "./AddViewMenu";
import { useElevationUpload } from "../../canvas/hooks/useElevationUpload";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { filledBuildingViews, isDefaultViewId, nodeForView, renderableBuildingViews } from "../../canvas/buildingViews";
import type { BuildingView } from "../../canvas/buildingViews";
import { focusViewNode } from "../../canvas/utils/placeImageNode";

function hiddenFileInput(id: string, onFile: (file: File) => void) {
  return (
    <input
      id={id}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) onFile(file);
      }}
    />
  );
}

export function RenderFromUploadZone() {
  const views = useCanvasStore((state) => state.views);
  const nodes = useCanvasStore((state) => state.nodes);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const selectView = useCanvasStore((state) => state.selectView);
  const skippedViewIds = useCanvasStore((state) => state.skippedViewIds);
  const toggleViewSkipped = useCanvasStore((state) => state.toggleViewSkipped);
  const { uploadToView, clearViewImage, removeView, isUploading, uploadingViewId } = useElevationUpload();
  const filledCount = filledBuildingViews(views, nodes).length;
  const renderCount = renderableBuildingViews(views, nodes, skippedViewIds).length;

  const pickFile = (viewId: string) => {
    document.getElementById(`elevation-input-${viewId}`)?.click();
  };

  return (
    <div className="building-views-panel" data-guide="control.uploads">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-primary">Elevations</p>
          <small>
            {filledCount === 0
              ? "Upload an elevation to render. Empty sides are skipped."
              : renderCount === filledCount
                ? `${filledCount} uploaded → ${filledCount} ${filledCount === 1 ? "render" : "renders"}. Untick one to skip it.`
                : `${renderCount} of ${filledCount} uploaded will render. Unticked elevations are skipped.`}
          </small>
        </div>
        <AddViewMenu />
      </div>

      <div className="building-view-list">
        {views.map((view, index) => (
          <ViewSlot
            key={view.id}
            view={view}
            index={index}
            active={view.id === activeViewId}
            imageUrl={nodeForView(nodes, view.id)?.imageUrl ?? null}
            uploading={uploadingViewId === view.id}
            disabled={isUploading}
            onSelect={() => {
              selectView(view.id);
              focusViewNode(view.id);
            }}
            onUpload={(file) => void uploadToView(view, file)}
            onPick={() => pickFile(view.id)}
            skipped={skippedViewIds.includes(view.id)}
            onToggleSkipped={() => toggleViewSkipped(view.id)}
            // The four standard sides always keep their slot, so removing one only drops its image.
            onRemove={isDefaultViewId(view.id) ? () => void clearViewImage(view.id) : () => void removeView(view.id)}
            removesSlot={!isDefaultViewId(view.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ViewSlot({
  view,
  index,
  active,
  imageUrl,
  uploading,
  disabled,
  onSelect,
  onUpload,
  onPick,
  skipped,
  onToggleSkipped,
  onRemove,
  removesSlot,
}: {
  view: BuildingView;
  index: number;
  active: boolean;
  imageUrl: string | null;
  uploading: boolean;
  disabled: boolean;
  onSelect: () => void;
  onUpload: (file: File) => void;
  onPick: () => void;
  skipped: boolean;
  onToggleSkipped: () => void;
  onRemove: () => void;
  removesSlot: boolean;
}) {
  const inputId = `elevation-input-${view.id}`;

  if (!imageUrl) {
    return (
      <div className={`view-slot-empty ${active ? "active" : ""}`}>
        {hiddenFileInput(inputId, onUpload)}
        <button type="button" onClick={() => { onSelect(); onPick(); }} disabled={disabled} title={`Add ${view.label.toLowerCase()}`}>
          <b>{index + 1}</b>
          <p>
            <strong>{view.label}</strong>
            <small>{uploading ? "Uploading…" : "Add elevation"}</small>
          </p>
        </button>
        {removesSlot && (
          <button type="button" className="view-slot-remove" onClick={onRemove} aria-label={`Remove ${view.label}`}>
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`view-upload-card ${active ? "active" : ""} ${skipped ? "is-skipped" : ""}`}>
      {hiddenFileInput(inputId, onUpload)}
      <label className="view-upload-include" title={skipped ? "Skipped — tick to render it" : "Will render — untick to skip"}>
        <input type="checkbox" checked={!skipped} onChange={onToggleSkipped} aria-label={`Render ${view.label}`} />
      </label>
      <b>{index + 1}</b>
      <button type="button" className="view-upload-thumb" onClick={onSelect}>
        <img src={imageUrl} alt="" />
      </button>
      <div>
        <button type="button" className="view-upload-title" onClick={onSelect}>
          <strong>{view.label}</strong>
          {skipped && <small className="view-upload-skipped">Skipped</small>}
        </button>
        <span className="view-upload-actions">
          <button type="button" onClick={onPick} disabled={disabled}>
            {uploading ? "Uploading…" : "Replace"}
          </button>
          <button
            type="button"
            className="view-upload-remove"
            onClick={onRemove}
            disabled={disabled}
            title={removesSlot ? `Remove ${view.label} and its image` : `Remove this image; the ${view.label} slot stays empty`}
          >
            Remove
          </button>
        </span>
      </div>
    </div>
  );
}
