import { useEffect } from "react";
import { Stage, Layer } from "react-konva";
import { useStageSize } from "./hooks/useStageSize";
import { usePanZoom } from "./hooks/usePanZoom";
import { useCanvasStore } from "./hooks/useCanvasStore";
import { ImageNode } from "./shapes/ImageNode";
import { CanvasEmptyState } from "./CanvasEmptyState";
import { useRenderJobsStore } from "./hooks/useRenderJobsStore";
import { useApiClient } from "../lib/apiClient";
import { reportClientError } from "../components/AppErrorHandling";

export function CanvasStage() {
  const apiClient = useApiClient();
  const { containerRef, size } = useStageSize();
  const setStageSize = useCanvasStore((state) => state.setStageSize);
  const { stagePosition, camera, handleWheel, handleDragEnd } = usePanZoom();
  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const activeViewId = useCanvasStore((state) => state.activeViewId);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const updateNode = useCanvasStore((state) => state.updateNode);

  const visibleNode = nodes.find((node) => node.elevationId === activeViewId && node.imageUrl) ?? null;
  // An image open full-size covers the canvas, so the upload prompt must not show through it.
  const isPreviewingRender = useRenderJobsStore(
    (state) => state.previewJobId !== null || state.previewImage !== null,
  );

  const handleNodeDragEnd = (id: string, x: number, y: number) => {
    updateNode(id, { x, y });
    apiClient.updateCanvasNode(id, { data: { x, y } }).catch((error) => {
      reportClientError(error);
    });
  };

  useEffect(() => {
    setStageSize(size);
  }, [size, setStageSize]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-w-0 min-h-0 overflow-hidden bg-surface"
      style={{
        backgroundImage: "radial-gradient(circle, #D8D8D4 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {!visibleNode && !isPreviewingRender && <CanvasEmptyState />}
      <Stage
        width={size.width}
        height={size.height}
        x={stagePosition.x}
        y={stagePosition.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        draggable
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
        onClick={(event) => {
          if (event.target === event.target.getStage()) selectNode(null);
        }}
      >
        <Layer>
          {visibleNode && (
            <ImageNode
              key={visibleNode.id}
              x={visibleNode.x}
              y={visibleNode.y}
              width={visibleNode.width}
              height={visibleNode.height}
              imageUrl={visibleNode.imageUrl}
              selected={selectedNodeId === visibleNode.id}
              draggable
              onSelect={() => selectNode(visibleNode.id)}
              onDragEnd={(x, y) => handleNodeDragEnd(visibleNode.id, x, y)}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
