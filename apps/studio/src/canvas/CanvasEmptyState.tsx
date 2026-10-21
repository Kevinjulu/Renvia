import { DropZone } from "../shell/panel/DropZone";
import { useElevationUpload } from "./hooks/useElevationUpload";
import { useCanvasStore } from "./hooks/useCanvasStore";
import { useGuideStore } from "../guide/useGuideStore";
import { useState } from "react";
import { useSamples } from "../lib/useSamples";
import { SamplesDialog } from "../shell/panel/SamplesDialog";

export function CanvasEmptyState() {
  const { uploadToActiveView, placeSampleDesign, isUploading } = useElevationUpload();
  const { designs } = useSamples();
  const [samplesOpen, setSamplesOpen] = useState(false);
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
        {designs.length > 0 && (
          <p className="guide-empty-tour">
            <button type="button" disabled={isUploading} onClick={() => setSamplesOpen(true)}>
              No design yet? Start from a sample
            </button>
          </p>
        )}
        {mode === "idle" && (
          <p className="guide-empty-tour">
            <button type="button" onClick={() => startTour("orientation")}>
              Take a tour of the studio
            </button>
          </p>
        )}
      </div>
      {samplesOpen && (
        <SamplesDialog
          mode="designs"
          onClose={() => setSamplesOpen(false)}
          onPickDesign={(sample) => {
            setSamplesOpen(false);
            void placeSampleDesign(sample);
          }}
        />
      )}
    </div>
  );
}
