import { useCallback, useState } from "react";
import { useApiClient } from "../../lib/apiClient";
import { reportLimit } from "../../lib/useLimitDialog";
import { nodeToPersistedData, placeImageInView } from "../utils/placeImageNode";
import { useCanvasStore } from "./useCanvasStore";
import { nodeForView, type BuildingView } from "../buildingViews";
import { useUploadProgressStore } from "./useUploadProgressStore";

export function useElevationUpload() {
  const apiClient = useApiClient();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingViewId, setUploadingViewId] = useState<string | null>(null);

  // Uploads one file into one elevation. Byte progress fills 0–90%; placing it on the canvas finishes it.
  const uploadOne = useCallback(
    async (view: BuildingView, file: File, onProgress: (fraction: number) => void) => {
      setUploadingViewId(view.id);
      const { publicUrl } = await apiClient.uploadImage(file, (fraction) => onProgress(fraction * 0.9));
      const { kind, node } = await placeImageInView(view, publicUrl);
      onProgress(1);

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
    },
    [apiClient],
  );

  // Runs uploads one after another and reports their combined progress to the rail's upload button.
  const runBatch = useCallback(
    async (count: number, uploadAt: (index: number, onProgress: (fraction: number) => void) => Promise<void>) => {
      const progress = useUploadProgressStore.getState();
      setIsUploading(true);
      progress.begin();
      let ok = false;
      try {
        for (let index = 0; index < count; index += 1) {
          await uploadAt(index, (fraction) => progress.report((index + fraction) / count));
        }
        ok = true;
      } catch (error) {
        // An oversized image is a limit refusal, not a broken upload — explain it and stop.
        if (!reportLimit(error)) throw error;
      } finally {
        progress.finish(ok);
        setIsUploading(false);
        setUploadingViewId(null);
      }
    },
    [],
  );

  const uploadToView = useCallback(
    (view: BuildingView, file: File) => runBatch(1, (_index, onProgress) => uploadOne(view, file, onProgress)),
    [runBatch, uploadOne],
  );

  // Fills empty elevations in order, adding a new one when every elevation already has an image.
  const uploadFiles = useCallback(
    (files: File[]) =>
      runBatch(files.length, async (index, onProgress) => {
        const { views, nodes, addBuildingView, selectView } = useCanvasStore.getState();
        let view = views.find((item) => !nodeForView(nodes, item.id));
        if (!view) {
          const id = addBuildingView(`Elevation ${views.length + 1}`);
          view = useCanvasStore.getState().views.find((item) => item.id === id);
        }
        if (!view) return;
        selectView(view.id);
        await uploadOne(view, files[index], onProgress);
      }),
    [runBatch, uploadOne],
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

  return { uploadToView, uploadFiles, uploadToActiveView, clearViewImage, removeView, isUploading, uploadingViewId };
}
