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
        }
      } finally {
        setIsUploading(false);
      }
    },
    [apiClient],
  );

  return { uploadElevation, isUploading };
}
