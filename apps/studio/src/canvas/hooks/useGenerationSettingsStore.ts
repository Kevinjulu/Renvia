import { create } from "zustand";

export type EditModeKind = "element" | "building" | "prompt";
export type EditAction = "add" | "remove" | "change";
export type SelectionMode = "auto" | "manual";

export const STYLE_INFLUENCE_LABELS = ["Minimal", "Balanced", "Strong", "Maximum"] as const;

interface GenerationSettingsState {
  prompt: string;
  editPrompt: string;
  resolution: string;
  style: string;
  styleInfluence: number;
  preserveStructure: boolean;
  referenceImageUrls: string[];
  atmospherePreset: string | null;
  editMode: EditModeKind;
  editAction: EditAction | null;
  selectionMode: SelectionMode;
  setPrompt: (prompt: string) => void;
  setEditPrompt: (prompt: string) => void;
  setResolution: (resolution: string) => void;
  setStyle: (style: string) => void;
  setStyleInfluence: (value: number) => void;
  setPreserveStructure: (value: boolean) => void;
  setReferenceImageUrls: (urls: string[]) => void;
  setAtmospherePreset: (label: string | null) => void;
  setEditMode: (mode: EditModeKind) => void;
  setEditAction: (action: EditAction | null) => void;
  setSelectionMode: (mode: SelectionMode) => void;
}

export const useGenerationSettingsStore = create<GenerationSettingsState>((set) => ({
  prompt: "",
  editPrompt: "",
  resolution: "1K",
  style: "Photorealistic",
  styleInfluence: 2,
  preserveStructure: true,
  referenceImageUrls: [],
  atmospherePreset: null,
  editMode: "element",
  editAction: null,
  selectionMode: "auto",
  setPrompt: (prompt) => set({ prompt }),
  setEditPrompt: (editPrompt) => set({ editPrompt }),
  setResolution: (resolution) => set({ resolution }),
  setStyle: (style) => set({ style }),
  setStyleInfluence: (styleInfluence) => set({ styleInfluence }),
  setPreserveStructure: (preserveStructure) => set({ preserveStructure }),
  setReferenceImageUrls: (referenceImageUrls) => set({ referenceImageUrls }),
  setAtmospherePreset: (atmospherePreset) => set({ atmospherePreset }),
  setEditMode: (editMode) => set({ editMode }),
  setEditAction: (editAction) => set({ editAction }),
  setSelectionMode: (selectionMode) => set({ selectionMode }),
}));
