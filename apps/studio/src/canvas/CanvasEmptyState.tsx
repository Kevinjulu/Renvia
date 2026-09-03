import { DropZone } from "../shell/panel/DropZone";
import { useElevationUpload } from "./hooks/useElevationUpload";

export function CanvasEmptyState() {
  const { uploadElevation, isUploading } = useElevationUpload();

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-10">
      <div className="pointer-events-auto w-full max-w-xl">
        <DropZone
          title="Drop an image here"
          showFormatBadges
          size="large"
          disabled={isUploading}
          onFileSelected={(file) => void uploadElevation(file)}
        />
      </div>
    </div>
  );
}
