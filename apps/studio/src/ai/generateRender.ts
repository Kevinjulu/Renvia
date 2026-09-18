import type { useApiClient } from "../lib/apiClient";
import { useGenerationSettingsStore } from "../canvas/hooks/useGenerationSettingsStore";
import { buildMaterialEditPrompt } from "./promptTemplates";

export async function generateRender(
  apiClient: ReturnType<typeof useApiClient>,
  projectId: string,
  sourceImageUrl: string,
  instruction: string,
  view?: { id: string; label: string },
) {
  const {
    resolution,
    style,
    styleInfluence,
    preserveStructure,
    referenceImageUrls,
    atmospherePreset,
  } = useGenerationSettingsStore.getState();

  return apiClient.createRender({
    projectId,
    sourceImageUrl,
    prompt: buildMaterialEditPrompt(instruction),
    resolution,
    style,
    viewKey: view?.id,
    viewLabel: view?.label,
    generationSettings: {
      styleInfluence,
      preserveStructure,
      referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
      atmospherePreset,
    },
  });
}
