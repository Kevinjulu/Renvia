import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Stage, Layer } from "react-konva";
import { useStageSize } from "./hooks/useStageSize";
import { usePanZoom } from "./hooks/usePanZoom";
import { useCanvasStore } from "./hooks/useCanvasStore";
import { useSelectionToolStore } from "./hooks/useSelectionToolStore";
import { ImageNode } from "./shapes/ImageNode";
import { SelectionOverlay } from "./shapes/SelectionOverlay";
import { CanvasEmptyState } from "./CanvasEmptyState";
import { EditToolbar } from "./EditToolbar";
import { useApiClient } from "../lib/apiClient";

const CLOSE_POLYGON_THRESHOLD = 10;

interface WorldPoint {
  x: number;
  y: number;
}

export function CanvasStage() {
  const apiClient = useApiClient();
  const { containerRef, size } = useStageSize();
  const setStageSize = useCanvasStore((state) => state.setStageSize);
  const { stagePosition, camera, handleWheel, handleDragEnd } = usePanZoom();
  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const updateNode = useCanvasStore((state) => state.updateNode);
  const activeTab = useCanvasStore((state) => state.activeTab);

  const activeTool = useSelectionToolStore((state) => state.activeTool);
  const setActiveTool = useSelectionToolStore((state) => state.setActiveTool);
  const selection = useSelectionToolStore((state) => state.selection);
  const targetNodeId = useSelectionToolStore((state) => state.targetNodeId);
  const commitSelection = useSelectionToolStore((state) => state.commitSelection);

  const targetNode = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0] ?? null;
  const isDrawing = activeTab === "edit" && activeTool !== null;

  const [draftRect, setDraftRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [draftPolygon, setDraftPolygon] = useState<number[]>([]);
  const [draftCursor, setDraftCursor] = useState<WorldPoint | null>(null);
  const isDraggingRect = useRef(false);
  const rectStart = useRef<WorldPoint | null>(null);

  const handleNodeDragEnd = (id: string, x: number, y: number) => {
    updateNode(id, { x, y });
    apiClient.updateCanvasNode(id, { data: { x, y } }).catch((error) => {
      console.error("Failed to save node position", error);
    });
  };

  useEffect(() => {
    setStageSize(size);
  }, [size, setStageSize]);

  const resetDraft = () => {
    isDraggingRect.current = false;
    rectStart.current = null;
    setDraftRect(null);
    setDraftPolygon([]);
    setDraftCursor(null);
  };

  useEffect(() => {
    if (!isDrawing) resetDraft();
  }, [isDrawing]);

  useEffect(() => {
    if (!isDrawing) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        resetDraft();
        setActiveTool(null);
      } else if (event.key === "Enter" && activeTool === "polygon" && draftPolygon.length >= 6) {
        finishPolygon();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawing, activeTool, draftPolygon]);

  function getWorldPoint(stage: Konva.Stage): WorldPoint | null {
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - stagePosition.x) / camera.scale,
      y: (pointer.y - stagePosition.y) / camera.scale,
    };
  }

  function finishPolygon() {
    if (!targetNode || draftPolygon.length < 6) {
      resetDraft();
      return;
    }
    const localPoints = draftPolygon.map((value, index) =>
      index % 2 === 0 ? value - targetNode.x : value - targetNode.y,
    );
    commitSelection(targetNode.id, { type: "polygon", points: localPoints });
    resetDraft();
  }

  const handleMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isDrawing || !targetNode) return;
    const stage = event.target.getStage();
    const world = stage ? getWorldPoint(stage) : null;
    if (!world) return;

    if (activeTool === "rectangle") {
      isDraggingRect.current = true;
      rectStart.current = world;
      setDraftRect({ x: world.x, y: world.y, width: 0, height: 0 });
      return;
    }

    if (activeTool === "polygon") {
      if (draftPolygon.length >= 6) {
        const startX = draftPolygon[0]!;
        const startY = draftPolygon[1]!;
        const distance = Math.hypot(world.x - startX, world.y - startY) * camera.scale;
        if (distance <= CLOSE_POLYGON_THRESHOLD) {
          finishPolygon();
          return;
        }
      }
      setDraftPolygon((points) => [...points, world.x, world.y]);
    }
  };

  const handleMouseMove = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isDrawing) return;
    const stage = event.target.getStage();
    const world = stage ? getWorldPoint(stage) : null;
    if (!world) return;

    if (activeTool === "rectangle" && isDraggingRect.current && rectStart.current) {
      const start = rectStart.current;
      setDraftRect({
        x: Math.min(start.x, world.x),
        y: Math.min(start.y, world.y),
        width: Math.abs(world.x - start.x),
        height: Math.abs(world.y - start.y),
      });
    } else if (activeTool === "polygon") {
      setDraftCursor(world);
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing || !targetNode) return;
    if (activeTool === "rectangle" && isDraggingRect.current && draftRect) {
      isDraggingRect.current = false;
      if (draftRect.width > 2 && draftRect.height > 2) {
        commitSelection(targetNode.id, {
          type: "rectangle",
          x: draftRect.x - targetNode.x,
          y: draftRect.y - targetNode.y,
          width: draftRect.width,
          height: draftRect.height,
        });
      }
      setDraftRect(null);
      rectStart.current = null;
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-w-0 min-h-0 overflow-hidden bg-surface"
      style={{
        backgroundImage: "radial-gradient(circle, #D8D8D4 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {nodes.length === 0 && <CanvasEmptyState />}
      {activeTab === "edit" && nodes.length > 0 && <EditToolbar />}
      <Stage
        width={size.width}
        height={size.height}
        x={stagePosition.x}
        y={stagePosition.y}
        scaleX={camera.scale}
        scaleY={camera.scale}
        draggable={!isDrawing}
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={() => {
          if (activeTool === "polygon") finishPolygon();
        }}
        onClick={(event) => {
          if (isDrawing) return;
          if (event.target === event.target.getStage()) selectNode(null);
        }}
      >
        <Layer>
          {nodes.map((node) => (
            <ImageNode
              key={node.id}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              imageUrl={node.imageUrl}
              selected={selectedNodeId === node.id}
              draggable={!isDrawing}
              onSelect={isDrawing ? undefined : () => selectNode(node.id)}
              onDragEnd={(x, y) => handleNodeDragEnd(node.id, x, y)}
            />
          ))}
          <SelectionOverlay
            targetOrigin={targetNode && targetNodeId === targetNode.id ? { x: targetNode.x, y: targetNode.y } : null}
            selection={selection}
            draftRect={draftRect}
            draftPolygon={draftPolygon}
            draftCursor={draftCursor}
          />
        </Layer>
      </Stage>
    </div>
  );
}
