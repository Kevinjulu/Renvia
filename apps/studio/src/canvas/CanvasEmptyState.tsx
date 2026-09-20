import { DropZone } from "../shell/panel/DropZone";
import { useElevationUpload } from "./hooks/useElevationUpload";
import { useCanvasStore } from "./hooks/useCanvasStore";
import { useGuideStore } from "../guide/useGuideStore";

export function CanvasEmptyState() {
  const { uploadToActiveView, isUploading } = useElevationUpload();
  const views = useCanvasStore((state) => state.views);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const startTour = useGuideStore((state) => state.startTour);
  const mode = useGuideStore((state) => state.mode);
  const activeView = views.find((view) => view.id === activeViewId);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-10">
      <div className="pointer-events-auto w-full max-w-xl">
        <DropZone
          title={activeView ? `Drop ${activeView.label.toLowerCase()}` : "Drop an image here"}
          showFormatBadges
          size="large"
          disabled={isUploading}
          onFileSelected={(file) => void uploadToActiveView(file)}
        />
        {mode === "idle" && (
          <p className="guide-empty-tour">
            <button type="button" onClick={() => startTour("orientation")}>
              Take a tour of the studio
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
