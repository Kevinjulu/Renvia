import { useCallback, useState } from "react";
import { useApiClient } from "../../lib/apiClient";
import { nodeToPersistedData, placeImageInView } from "../utils/placeImageNode";
import { useCanvasStore } from "./useCanvasStore";
import type { BuildingView } from "../buildingViews";

export function useElevationUpload() {
  const apiClient = useApiClient();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingViewId, setUploadingViewId] = useState<string | null>(null);

  const uploadToView = useCallback(
    async (view: BuildingView, file: File) => {
      setIsUploading(true);
      setUploadingViewId(view.id);
      try {
        const { publicUrl } = await apiClient.uploadImage(file);
        const { kind, node } = await placeImageInView(view, publicUrl);

        const projectId = useCanvasStore.getState().projectId;
        if (projectId) {
          const persist =
            kind === "created"
              ? apiClient.createCanvasNode({ id: node.id, projectId, type: node.type, data: nodeToPersistedData(node) })
              : apiClient.updateCanvasNode(node.id, { data: nodeToPersistedData(node) });
          persist.catch((error) => console.error("Failed to save canvas node", error));

          apiClient
            .updateProject(projectId, { thumbnailUrl: publicUrl })
            .catch((error) => console.error("Failed to update project thumbnail", error));
        }
      } finally {
        setIsUploading(false);
        setUploadingViewId(null);
      }
    },
    [apiClient],
  );

  const uploadToActiveView = useCallback(
    async (file: File) => {
      const { views, activeViewId } = useCanvasStore.getState();
      const view = views.find((item) => item.id === activeViewId) ?? views[0];
      if (!view) return;
      await uploadToView(view, file);
    },
    [uploadToView],
  );

  const clearViewImage = useCallback(
    async (viewId: string) => {
      const { nodes, removeNode } = useCanvasStore.getState();
      const node = nodes.find((item) => item.elevationId === viewId);
      if (!node) return;
      removeNode(node.id);
      try {
        await apiClient.deleteCanvasNode(node.id);
      } catch (error) {
        console.error("Failed to delete canvas node", error);
      }
    },
    [apiClient],
  );

  const removeView = useCallback(
    async (viewId: string) => {
      const nodeIds = useCanvasStore.getState().removeBuildingView(viewId);
      await Promise.all(
        nodeIds.map((id) => apiClient.deleteCanvasNode(id).catch((error) => console.error("Failed to delete canvas node", error))),
      );
    },
    [apiClient],
  );

  return { uploadToView, uploadToActiveView, clearViewImage, removeView, isUploading, uploadingViewId };
}
