import { DropZone } from "./DropZone";
import { useElevationUpload } from "../../canvas/hooks/useElevationUpload";

interface RenderFromUploadZoneProps {
  currentImageUrl: string | null;
}

export function RenderFromUploadZone({ currentImageUrl }: RenderFromUploadZoneProps) {
  const { uploadElevation, isUploading } = useElevationUpload();

  return (
    <div className="building-views-panel">
      <div className="flex items-center justify-between">
        <div><p className="text-sm font-semibold text-primary">Building views</p><small>Upload up to 4 elevations for a unified render.</small></div>
        <button type="button" disabled title="Duplicate (coming soon)" className="text-faint">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="2" y="4" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.1" />
            <path d="M5 4V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </div>
      <div className="mt-3">
        {currentImageUrl ? (
          <div className="view-upload-card active">
            <b>1</b><img src={currentImageUrl} alt="" />
            <div><strong>Front view</strong>
            <button
              type="button"
              onClick={() => document.getElementById("elevation-replace-input")?.click()}
              className="text-xs font-medium text-blueprint hover:underline"
            >
              Replace image
            </button>
            </div><span>✓</span>
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
      {currentImageUrl && <div className="view-placeholders">{["Right view", "Back view", "Left view"].map((name,index)=><button type="button" key={name} title={`Add ${name.toLowerCase()}`}><b>{index+2}</b><span>＋</span><p><strong>{name}</strong><small>Add view</small></p></button>)}</div>}
    </div>
  );
}
