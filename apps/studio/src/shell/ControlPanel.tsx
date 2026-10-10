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
import { leaveEditTab, openEditTab, useRenderEditStore } from "../canvas/hooks/useRenderEditStore";
import { useRenderJobsStore } from "../canvas/hooks/useRenderJobsStore";
import { suggestedEditPartForPrompt } from "@renvia/types";

interface ControlPanelProps {
  projectId: string;
}

export function ControlPanel({ projectId }: ControlPanelProps) {
  const activeTab = useCanvasStore((state) => state.activeTab);
  const setActiveTab = useCanvasStore((state) => state.setActiveTab);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const prompt = useGenerationSettingsStore((state) => state.prompt);
  const setPrompt = useGenerationSettingsStore((state) => state.setPrompt);
  const aspectRatio = useGenerationSettingsStore((state) => state.aspectRatio);
  const setAspectRatio = useGenerationSettingsStore((state) => state.setAspectRatio);
  const style = useGenerationSettingsStore((state) => state.style);
  const setStyle = useGenerationSettingsStore((state) => state.setStyle);
  const editTargetJobId = useRenderEditStore((state) => state.targetJobId);
  const editRender = useRenderJobsStore((state) => state.jobs.find((job) => job.id === editTargetJobId && job.resultImageUrl) ?? null);
  const latestRenderForView = useRenderJobsStore((state) =>
    state.jobs.find((job) => job.status === "succeeded" && job.resultImageUrl && job.viewKey === activeViewId) ?? null,
  );
  const movePromptToEdit = () => {
    const suggestedPart = suggestedEditPartForPrompt(prompt);
    if (!suggestedPart) return;
    useGenerationSettingsStore.getState().setEditPrompt(prompt);
    useGenerationSettingsStore.getState().setEditMethod("prompt");
    setActiveTab("edit");
  };

  return (
    <div className="cp-panel">
      <RenderEditTabs active={activeTab} onChange={(tab) => (tab === "edit" ? openEditTab() : leaveEditTab())} />

      <div className="cp-scroll">
        {activeTab === "render" ? (
          <>
            <ActiveElevationCard />
            <div className="cp-row" data-guide="control.style">
              <StylePicker value={style} onChange={setStyle} />
              <AspectRatioPicker value={aspectRatio} onChange={setAspectRatio} />
            </div>
            <RenderTabBody prompt={prompt} onPromptChange={setPrompt} onMoveToEdit={movePromptToEdit} />
          </>
        ) : (
          <>
            {editRender && <EditModeHeader render={editRender} />}
            <EditTabBody
              pendingRenderJobId={editRender ? null : (latestRenderForView?.id ?? null)}
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
