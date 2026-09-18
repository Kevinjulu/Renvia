import { DropZone } from "../shell/panel/DropZone";
import { useElevationUpload } from "./hooks/useElevationUpload";
import { useCanvasStore } from "./hooks/useCanvasStore";

export function CanvasEmptyState() {
  const { uploadToActiveView, isUploading } = useElevationUpload();
  const views = useCanvasStore((state) => state.views);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
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
      </div>
    </div>
  );
}
