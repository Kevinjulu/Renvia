import type { useApiClient } from "../lib/apiClient";
import { useGenerationSettingsStore } from "../canvas/hooks/useGenerationSettingsStore";
import { buildMaterialEditPrompt } from "./promptTemplates";

export async function generateRender(
  apiClient: ReturnType<typeof useApiClient>,
  projectId: string,
  sourceImageUrl: string,
  instruction: string,
) {
  const { resolution, style } = useGenerationSettingsStore.getState();
  return apiClient.createRender({
    projectId,
    sourceImageUrl,
    prompt: buildMaterialEditPrompt(instruction),
    resolution,
    style,
  });
}
