import type { CanvasNodeRecord } from "@renvia/types";
import { MAX_ZOOM, MIN_ZOOM } from "../constants";
import { useCanvasStore, type CanvasNode } from "../hooks/useCanvasStore";

const NODE_MAX_WIDTH = 640;
const FIT_PADDING = 0.7;

export function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

function computeFitScale(
  stageSize: { width: number; height: number },
  nodeWidth: number,
  nodeHeight: number,
): number {
  if (stageSize.width === 0 || stageSize.height === 0) return 1;
  const scale = Math.min(1, (stageSize.width * FIT_PADDING) / nodeWidth, (stageSize.height * FIT_PADDING) / nodeHeight);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * Adds a new image node centered on the world origin and resets the camera
 * so that origin sits at the middle of the stage — the node lands centered
 * in view no matter what the previous pan/zoom state was.
 */
export async function placeCenteredImageNode(imageUrl: string): Promise<CanvasNode> {
  const { width, height } = await loadImageSize(imageUrl);
  const scale = Math.min(1, NODE_MAX_WIDTH / width);
  const nodeWidth = width * scale;
  const nodeHeight = height * scale;

  const { stageSize, addNode, setCamera } = useCanvasStore.getState();
  const node: CanvasNode = {
    id: crypto.randomUUID(),
    type: "image",
    x: -nodeWidth / 2,
    y: -nodeHeight / 2,
    width: nodeWidth,
    height: nodeHeight,
    imageUrl,
  };

  addNode(node);
  setCamera({ x: 0, y: 0, scale: computeFitScale(stageSize, nodeWidth, nodeHeight) });

  return node;
}

export function nodeToPersistedData(node: CanvasNode): Record<string, unknown> {
  return { x: node.x, y: node.y, width: node.width, height: node.height, imageUrl: node.imageUrl };
}

export function canvasNodeFromRecord(record: CanvasNodeRecord): CanvasNode {
  const data = record.data as Partial<CanvasNode>;
  return {
    id: record.id,
    type: record.type,
    x: data.x ?? 0,
    y: data.y ?? 0,
    width: data.width ?? 0,
    height: data.height ?? 0,
    imageUrl: data.imageUrl ?? "",
    elevationId: data.elevationId,
  };
}

export interface SetAsBaseResult {
  kind: "created" | "updated";
  node: CanvasNode;
}

/**
 * Replaces the current (selected, or most recent) node's image and
 * re-centers the camera on it — used to promote a render result to the
 * base image for the next generation.
 */
export async function setImageAsBaseNode(imageUrl: string): Promise<SetAsBaseResult> {
  const { width, height } = await loadImageSize(imageUrl);
  const scale = Math.min(1, NODE_MAX_WIDTH / width);
  const nodeWidth = width * scale;
  const nodeHeight = height * scale;

  const { stageSize, nodes, selectedNodeId, updateNode, addNode, selectNode, setCamera } =
    useCanvasStore.getState();
  const targetId = selectedNodeId ?? nodes[0]?.id ?? null;
  const patch = { x: -nodeWidth / 2, y: -nodeHeight / 2, width: nodeWidth, height: nodeHeight, imageUrl };

  let result: SetAsBaseResult;
  if (targetId) {
    updateNode(targetId, patch);
    selectNode(targetId);
    const updatedNode = useCanvasStore.getState().nodes.find((node) => node.id === targetId)!;
    result = { kind: "updated", node: updatedNode };
  } else {
    const node: CanvasNode = { id: crypto.randomUUID(), type: "image", ...patch };
    addNode(node);
    selectNode(node.id);
    result = { kind: "created", node };
  }

  setCamera({ x: 0, y: 0, scale: computeFitScale(stageSize, nodeWidth, nodeHeight) });

  return result;
}
