import { ProjectDropdown } from "./panel/ProjectDropdown";
import { RenderFromUploadZone } from "./panel/RenderFromUploadZone";
import { StylePicker } from "./panel/StylePicker";
import { ResolutionPicker } from "./panel/ResolutionPicker";
import { RenderEditTabs } from "./panel/RenderEditTabs";
import { RenderTabBody } from "./panel/RenderTabBody";
import { EditTabBody } from "./panel/EditTabBody";
import { GenerateBar } from "./panel/GenerateBar";
import { useGenerationSettingsStore } from "../canvas/hooks/useGenerationSettingsStore";
import { useCanvasStore } from "../canvas/hooks/useCanvasStore";

interface ControlPanelProps {
  projectId: string;
  projectName: string;
  currentImageUrl: string | null;
}

export function ControlPanel({ projectId, projectName, currentImageUrl }: ControlPanelProps) {
  const activeTab = useCanvasStore((state) => state.activeTab);
  const setActiveTab = useCanvasStore((state) => state.setActiveTab);
  const prompt = useGenerationSettingsStore((state) => state.prompt);
  const setPrompt = useGenerationSettingsStore((state) => state.setPrompt);
  const resolution = useGenerationSettingsStore((state) => state.resolution);
  const setResolution = useGenerationSettingsStore((state) => state.setResolution);
  const style = useGenerationSettingsStore((state) => state.style);
  const setStyle = useGenerationSettingsStore((state) => state.setStyle);

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-hairline bg-white p-4">
      <ProjectDropdown projectName={projectName} />

      <RenderFromUploadZone currentImageUrl={currentImageUrl} />
      <StylePicker value={style} onChange={setStyle} />
      <ResolutionPicker value={resolution} onChange={setResolution} />

      <div className="flex flex-1 flex-col">
        <RenderEditTabs active={activeTab} onChange={setActiveTab} />
        <div className="mt-4 flex flex-1 flex-col">
          {activeTab === "render" ? (
            <RenderTabBody prompt={prompt} onPromptChange={setPrompt} />
          ) : (
            <EditTabBody />
          )}
        </div>
      </div>

      <GenerateBar projectId={projectId} sourceImageUrl={currentImageUrl} prompt={prompt} />
    </div>
  );
}
