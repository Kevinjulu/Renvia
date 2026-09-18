import { create } from "zustand";
import {
  createDefaultBuildingViews,
  hydrateBuildingViews,
  nodeForView,
  type BuildingView,
  type BuildingViewKey,
} from "../buildingViews";

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
  viewKey?: BuildingViewKey;
  viewLabel?: string;
}

export interface CanvasCamera {
  x: number;
  y: number;
  scale: number;
}

interface CanvasState {
  projectId: string | null;
  nodes: CanvasNode[];
  views: BuildingView[];
  activeViewId: string;
  selectedNodeId: string | null;
  activeTab: PanelTab;
  /** World-space point rendered at the center of the stage container, plus zoom. */
  camera: CanvasCamera;
  stageSize: { width: number; height: number };
  setProjectId: (projectId: string | null) => void;
  selectNode: (id: string | null) => void;
  selectView: (id: string) => void;
  addBuildingView: (label: string) => string;
  removeBuildingView: (id: string) => string[];
  setActiveTab: (tab: PanelTab) => void;
  setCamera: (camera: CanvasCamera) => void;
  setStageSize: (size: { width: number; height: number }) => void;
  addNode: (node: CanvasNode) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  removeNode: (id: string) => void;
  setNodes: (nodes: CanvasNode[]) => void;
}

function selectionForView(nodes: CanvasNode[], viewId: string): string | null {
  return nodeForView(nodes, viewId)?.id ?? null;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  projectId: null,
  nodes: [],
  views: createDefaultBuildingViews(),
  activeViewId: "front",
  selectedNodeId: null,
  activeTab: "render",
  camera: { x: 0, y: 0, scale: 1 },
  stageSize: { width: 0, height: 0 },
  setProjectId: (projectId) =>
    set({
      projectId,
      nodes: [],
      views: createDefaultBuildingViews(),
      activeViewId: "front",
      selectedNodeId: null,
    }),
  selectNode: (id) => set({ selectedNodeId: id }),
  selectView: (id) =>
    set((state) => ({
      activeViewId: id,
      selectedNodeId: selectionForView(state.nodes, id),
    })),
  addBuildingView: (label) => {
    const view: BuildingView = {
      id: crypto.randomUUID(),
      key: "extra",
      label: label.trim() || "Custom view",
    };
    set((state) => ({
      views: [...state.views, view],
      activeViewId: view.id,
      selectedNodeId: null,
    }));
    return view.id;
  },
  removeBuildingView: (id) => {
    const removedNodeIds: string[] = [];
    set((state) => {
      const views = state.views.filter((view) => view.id !== id);
      const nodes = state.nodes.filter((node) => {
        if (node.elevationId !== id) return true;
        removedNodeIds.push(node.id);
        return false;
      });
      const activeViewId = state.activeViewId === id ? (views[0]?.id ?? "front") : state.activeViewId;
      return {
        views,
        nodes,
        activeViewId,
        selectedNodeId: selectionForView(nodes, activeViewId),
      };
    });
    return removedNodeIds;
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  setCamera: (camera) => set({ camera }),
  setStageSize: (stageSize) => set({ stageSize }),
  addNode: (node) =>
    set((state) => {
      const nodes = [...state.nodes.filter((existing) => existing.id !== node.id), node];
      const views =
        node.elevationId && !state.views.some((view) => view.id === node.elevationId)
          ? [
              ...state.views,
              {
                id: node.elevationId,
                key: (node.viewKey ?? "extra") as BuildingView["key"],
                label: node.viewLabel ?? "Custom view",
              },
            ]
          : state.views;
      const activeViewId = node.elevationId ?? state.activeViewId;
      return {
        nodes,
        views,
        activeViewId,
        selectedNodeId: node.id,
      };
    }),
  updateNode: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    })),
  removeNode: (id) =>
    set((state) => {
      const nodes = state.nodes.filter((node) => node.id !== id);
      return {
        nodes,
        selectedNodeId: state.selectedNodeId === id ? selectionForView(nodes, state.activeViewId) : state.selectedNodeId,
      };
    }),
  setNodes: (incoming) =>
    set((state) => {
      const { views, nodes } = hydrateBuildingViews(incoming);
      const activeViewId = views.some((view) => view.id === state.activeViewId) ? state.activeViewId : views[0]!.id;
      return {
        nodes,
        views,
        activeViewId,
        selectedNodeId: selectionForView(nodes, activeViewId),
      };
    }),
}));
