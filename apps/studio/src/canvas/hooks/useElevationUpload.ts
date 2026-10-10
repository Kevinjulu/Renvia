import { useCallback, useState } from "react";
import { useApiClient } from "../../lib/apiClient";
import { reportLimit } from "../../lib/useLimitDialog";
import { nodeToPersistedData, placeImageInView } from "../utils/placeImageNode";
import { useCanvasStore } from "./useCanvasStore";
import { nodeForView, type BuildingView } from "../buildingViews";
import { useUploadProgressStore } from "./useUploadProgressStore";
import { reportClientError } from "../../components/AppErrorHandling";
import { showStudioNotice } from "../../shell/StudioNotice";

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
        persist.catch((error) => {
          reportClientError(error);
          showStudioNotice(`${view.label} is on the canvas, but it couldn't be saved. Upload it again before you reload.`);
        });

        apiClient
          .updateProject(projectId, { thumbnailUrl: publicUrl })
          .catch((error) => reportClientError(error));
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
        if (!reportLimit(error)) {
          reportClientError(error);
          showStudioNotice("Upload failed. Check that the file is a PNG, JPG, or WEBP and try again.");
        }
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
        const file = files[index];
        if (!file) return;
        const { views, nodes, addBuildingView, selectView } = useCanvasStore.getState();
        let view = views.find((item) => !nodeForView(nodes, item.id));
        if (!view) {
          const id = addBuildingView(`Elevation ${views.length + 1}`);
          view = useCanvasStore.getState().views.find((item) => item.id === id);
        }
        if (!view) return;
        selectView(view.id);
        await uploadOne(view, file, onProgress);
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
        // Still saved, so it would come back on reload: put it back now and say so.
        reportClientError(error);
        useCanvasStore.getState().addNode(node);
        showStudioNotice("Couldn't remove that image. It's back on the canvas — try again.");
      }
    },
    [apiClient],
  );

  const removeView = useCallback(
    async (viewId: string) => {
      const removed = useCanvasStore.getState().nodes.filter((node) => node.elevationId === viewId);
      useCanvasStore.getState().removeBuildingView(viewId);
      const failed = (
        await Promise.all(
          removed.map((node) =>
            apiClient.deleteCanvasNode(node.id).then(
              () => null,
              (error) => {
                reportClientError(error);
                return node;
              },
            ),
          ),
        )
      ).filter((node) => node !== null);
      // Restoring a node also restores its elevation, so the canvas matches what's saved.
      if (failed.length > 0) {
        failed.forEach((node) => useCanvasStore.getState().addNode(node));
        showStudioNotice("Couldn't remove that elevation. It's back on the canvas — try again.");
      }
    },
    [apiClient],
  );

  return { uploadToView, uploadFiles, uploadToActiveView, clearViewImage, removeView, isUploading, uploadingViewId };
}
