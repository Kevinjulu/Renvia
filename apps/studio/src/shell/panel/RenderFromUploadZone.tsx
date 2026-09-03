import { DropZone } from "./DropZone";
import { useElevationUpload } from "../../canvas/hooks/useElevationUpload";

interface RenderFromUploadZoneProps {
  currentImageUrl: string | null;
}

export function RenderFromUploadZone({ currentImageUrl }: RenderFromUploadZoneProps) {
  const { uploadElevation, isUploading } = useElevationUpload();

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-primary">Render from</p>
        <button type="button" disabled title="Duplicate (coming soon)" className="text-faint">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.1" />
            <path d="M5 4V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </div>
      <div className="mt-2">
        {currentImageUrl ? (
          <div className="flex items-center gap-3 rounded-lg border border-hairline p-2">
            <img src={currentImageUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
            <button
              type="button"
              onClick={() => document.getElementById("elevation-replace-input")?.click()}
              className="text-xs font-medium text-blueprint hover:underline"
            >
              Replace image
            </button>
            <input
              id="elevation-replace-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadElevation(file);
              }}
            />
          </div>
        ) : (
          <DropZone
            title="Drop an image to start"
            disabled={isUploading}
            onFileSelected={(file) => void uploadElevation(file)}
          />
        )}
      </div>
    </div>
  );
}
