import { ActiveElevationCard } from "./panel/ActiveElevationCard";
import { StylePicker } from "./panel/StylePicker";
import { AspectRatioPicker } from "./panel/AspectRatioPicker";
import { RenderEditTabs } from "./panel/RenderEditTabs";
import { RenderTabBody } from "./panel/RenderTabBody";
import { EditTabBody } from "./panel/EditTabBody";
import { EditModeHeader } from "./panel/EditModeHeader";
import { GenerateBar } from "./panel/GenerateBar";
import { useGenerationSettingsStore } from "../canvas/hooks/useGenerationSettingsStore";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";
import { nodeForView } from "../canvas/buildingViews";
import { useRenderEditStore } from "../canvas/hooks/useRenderEditStore";
import { useRenderJobsStore } from "../canvas/hooks/useRenderJobsStore";
import { useSelectionToolStore } from "../canvas/hooks/useSelectionToolStore";

interface ControlPanelProps {
  projectId: string;
}

export function ControlPanel({ projectId }: ControlPanelProps) {
  const activeTab = useCanvasStore((state) => state.activeTab);
  const setActiveTab = useCanvasStore((state) => state.setActiveTab);
  const nodes = useCanvasStore((state) => state.nodes);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const prompt = useGenerationSettingsStore((state) => state.prompt);
  const setPrompt = useGenerationSettingsStore((state) => state.setPrompt);
  const aspectRatio = useGenerationSettingsStore((state) => state.aspectRatio);
  const setAspectRatio = useGenerationSettingsStore((state) => state.setAspectRatio);
  const style = useGenerationSettingsStore((state) => state.style);
  const setStyle = useGenerationSettingsStore((state) => state.setStyle);
  const editTargetJobId = useRenderEditStore((state) => state.targetJobId);
  const editRender = useRenderJobsStore((state) => state.jobs.find((job) => job.id === editTargetJobId && job.resultImageUrl) ?? null);
  const currentImageUrl = editRender?.resultImageUrl ?? nodeForView(nodes, activeViewId)?.imageUrl ?? null;
  const latestRenderForView = useRenderJobsStore((state) =>
    state.jobs.find((job) => job.status === "succeeded" && job.resultImageUrl && job.viewKey === activeViewId) ?? null,
  );
  // A rectangle/polygon drawn on the original upload, before any render exists for this view.
  const editNode = nodeForView(nodes, activeViewId);
  const canvasSelection = useSelectionToolStore((state) => state.selection);
  const canvasSelectionNodeId = useSelectionToolStore((state) => state.targetNodeId);
  const clearCanvasSelection = useSelectionToolStore((state) => state.clearSelection);
  const hasCanvasSelection = Boolean(canvasSelection && editNode && canvasSelectionNodeId === editNode.id);

  return (
    <div className="cp-panel">
      <RenderEditTabs active={activeTab} onChange={setActiveTab} />

      <div className="cp-scroll">
        {activeTab === "render" ? (
          <>
            <ActiveElevationCard />
            <div className="cp-row" data-guide="control.style">
              <StylePicker value={style} onChange={setStyle} />
              <AspectRatioPicker value={aspectRatio} onChange={setAspectRatio} />
            </div>
            <RenderTabBody prompt={prompt} onPromptChange={setPrompt} />
          </>
        ) : (
          <>
            <EditModeHeader render={editRender} currentImageUrl={editRender ? null : currentImageUrl} />
            <EditTabBody
              currentImageUrl={currentImageUrl}
              pendingRenderJobId={editRender ? null : (latestRenderForView?.id ?? null)}
              hasCanvasSelection={hasCanvasSelection}
              onClearCanvasSelection={clearCanvasSelection}
            />
          </>
        )}
      </div>

      <div className="studio-generate-bar" data-guide="control.generate">
        <GenerateBar projectId={projectId} />
      </div>
    </div>
  );
}
