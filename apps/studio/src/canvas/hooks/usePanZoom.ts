import { useCallback } from "react";
import type Konva from "konva";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "../constants";
import { useCanvasStore } from "./useCanvasStore";

/**
 * The camera always renders its (x, y) world point at the center of the
 * stage container, so zooming never has to "anchor" on the pointer — the
 * center point stays fixed on screen and only the scale changes. This is
 * what keeps a centered image from drifting toward a corner while zooming.
 */
export function usePanZoom() {
  const camera = useCanvasStore((state) => state.camera);
  const setCamera = useCanvasStore((state) => state.setCamera);
  const stageSize = useCanvasStore((state) => state.stageSize);

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();

      const direction = event.evt.deltaY > 0 ? -1 : 1;
      const nextScale = direction > 0 ? camera.scale * ZOOM_STEP : camera.scale / ZOOM_STEP;
      const clampedScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale));

      setCamera({ ...camera, scale: clampedScale });
    },
    [camera, setCamera],
  );

  const handleDragEnd = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      const stage = event.target;
      setCamera({
        scale: camera.scale,
        x: (stageSize.width / 2 - stage.x()) / camera.scale,
        y: (stageSize.height / 2 - stage.y()) / camera.scale,
      });
    },
    [camera, stageSize, setCamera],
  );

  const stagePosition = {
    x: stageSize.width / 2 - camera.x * camera.scale,
    y: stageSize.height / 2 - camera.y * camera.scale,
  };

  return { camera, stagePosition, handleWheel, handleDragEnd };
}
