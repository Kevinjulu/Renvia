import { create } from "zustand";

export type PanelTab = "render" | "edit";

export interface CanvasNode {
  id: string;
  type: "image" | "compare-slider";
  x: number;
  y: number;
  width: number;
  height: number;
  imageUrl: string;
  elevationId?: string;
}

export interface CanvasCamera {
  x: number;
  y: number;
  scale: number;
}

interface CanvasState {
  projectId: string | null;
  nodes: CanvasNode[];
  selectedNodeId: string | null;
  activeTab: PanelTab;
  /** World-space point rendered at the center of the stage container, plus zoom. */
  camera: CanvasCamera;
  stageSize: { width: number; height: number };
  setProjectId: (projectId: string | null) => void;
  selectNode: (id: string | null) => void;
  setActiveTab: (tab: PanelTab) => void;
  setCamera: (camera: CanvasCamera) => void;
  setStageSize: (size: { width: number; height: number }) => void;
  addNode: (node: CanvasNode) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  removeNode: (id: string) => void;
  setNodes: (nodes: CanvasNode[]) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  projectId: null,
  nodes: [],
  selectedNodeId: null,
  activeTab: "render",
  camera: { x: 0, y: 0, scale: 1 },
  stageSize: { width: 0, height: 0 },
  setProjectId: (projectId) => set({ projectId }),
  selectNode: (id) => set({ selectedNodeId: id }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setCamera: (camera) => set({ camera }),
  setStageSize: (stageSize) => set({ stageSize }),
  addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),
  updateNode: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    })),
  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    })),
  setNodes: (nodes) => set({ nodes }),
}));
