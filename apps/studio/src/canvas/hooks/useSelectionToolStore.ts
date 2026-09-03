import { create } from "zustand";

export type SelectionTool = "rectangle" | "polygon";

export type SelectionShape =
  | { type: "rectangle"; x: number; y: number; width: number; height: number }
  | { type: "polygon"; points: number[] };

interface SelectionToolState {
  /** The tool currently armed for drawing. Null means the pointer just pans/selects as usual. */
  activeTool: SelectionTool | null;
  /** id of the canvas node the committed selection is anchored to, in that node's local coordinates. */
  targetNodeId: string | null;
  selection: SelectionShape | null;
  setActiveTool: (tool: SelectionTool | null) => void;
  commitSelection: (nodeId: string, shape: SelectionShape) => void;
  clearSelection: () => void;
}

export const useSelectionToolStore = create<SelectionToolState>((set) => ({
  activeTool: null,
  targetNodeId: null,
  selection: null,
  setActiveTool: (tool) => set({ activeTool: tool }),
  commitSelection: (nodeId, shape) =>
    set({ selection: shape, targetNodeId: nodeId, activeTool: null }),
  clearSelection: () => set({ selection: null, targetNodeId: null }),
}));
