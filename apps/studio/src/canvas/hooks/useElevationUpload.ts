import { useCallback, useState } from "react";
import { useApiClient } from "../../lib/apiClient";
import { nodeToPersistedData, placeCenteredImageNode } from "../utils/placeImageNode";
import { useCanvasStore } from "./useCanvasStore";

export function useElevationUpload() {
  const apiClient = useApiClient();
  const [isUploading, setIsUploading] = useState(false);

  const uploadElevation = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        const { publicUrl } = await apiClient.uploadImage(file);
        const node = await placeCenteredImageNode(publicUrl);

        const projectId = useCanvasStore.getState().projectId;
        if (projectId) {
          apiClient
            .createCanvasNode({ id: node.id, projectId, type: node.type, data: nodeToPersistedData(node) })
            .catch((error) => console.error("Failed to save canvas node", error));

          // The most recently uploaded elevation doubles as the project's
          // dashboard cover image, so there's no separate "set thumbnail" step.
          apiClient
            .updateProject(projectId, { thumbnailUrl: publicUrl })
            .catch((error) => console.error("Failed to update project thumbnail", error));
        }
      } finally {
        setIsUploading(false);
      }
    },
    [apiClient],
  );

  return { uploadElevation, isUploading };
}
