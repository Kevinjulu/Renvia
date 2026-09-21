import { AddViewMenu } from "./AddViewMenu";
import { useElevationUpload } from "../../canvas/hooks/useElevationUpload";
import { useCanvasStore } from "../../canvas/hooks/useCanvasStore";
import { filledBuildingViews, isDefaultViewId, nodeForView } from "../../canvas/buildingViews";
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
  const { uploadToView, clearViewImage, removeView, isUploading, uploadingViewId } = useElevationUpload();
  const filledCount = filledBuildingViews(views, nodes).length;

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
              : filledCount === 1
                ? "1 elevation uploaded → 1 render. Empty sides are skipped."
                : `${filledCount} elevations uploaded → ${filledCount} renders. Empty sides are skipped.`}
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
            onClear={() => void clearViewImage(view.id)}
            onRemove={isDefaultViewId(view.id) ? undefined : () => void removeView(view.id)}
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
  onClear,
  onRemove,
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
  onClear: () => void;
  onRemove?: () => void;
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
        {onRemove && (
          <button type="button" className="view-slot-remove" onClick={onRemove} aria-label={`Remove ${view.label}`}>
            ×
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`view-upload-card ${active ? "active" : ""}`}>
      {hiddenFileInput(inputId, onUpload)}
      <b>{index + 1}</b>
      <button type="button" className="view-upload-thumb" onClick={onSelect}>
        <img src={imageUrl} alt="" />
      </button>
      <div>
        <button type="button" className="view-upload-title" onClick={onSelect}>
          <strong>{view.label}</strong>
        </button>
        <span className="view-upload-actions">
          <button type="button" onClick={onPick} disabled={disabled}>
            {uploading ? "Uploading…" : "Replace"}
          </button>
          <button type="button" onClick={onClear} disabled={disabled}>
            Clear
          </button>
          {onRemove && (
            <button type="button" onClick={onRemove} disabled={disabled}>
              Remove
            </button>
          )}
        </span>
      </div>
      <span>✓</span>
    </div>
  );
}
