import { create } from "zustand";
import { useGenerationSettingsStore } from "./useGenerationSettingsStore";

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
  commitSelection: (nodeId, shape) => {
    set({ selection: shape, targetNodeId: nodeId, activeTool: null });
    // Drawing a rectangle/polygon directly on the original image is a manual selection —
    // keep the Edit panel's mode toggle in sync with what the user actually just did.
    useGenerationSettingsStore.getState().setSelectionMode("manual");
  },
  clearSelection: () => set({ selection: null, targetNodeId: null }),
}));
