import { create } from "zustand";
import type { EditAction, EditMode, RenderGenerationSettings, RenderSourceType } from "@renvia/types";

export type { EditAction, EditMode };
export type SelectionMode = "auto" | "manual";

export const STYLE_INFLUENCE_LABELS = ["Minimal", "Balanced", "Strong", "Maximum"] as const;

interface GenerationSettingsState {
  prompt: string;
  editPrompt: string;
  resolution: string;
  style: string;
  sourceType: RenderSourceType;
  styleInfluence: number;
  preserveStructure: boolean;
  referenceImageUrls: string[];
  /** UI-only: which quick-atmosphere chip filled the prompt. */
  atmospherePreset: string | null;
  editMode: EditMode;
  editAction: EditAction | null;
  selectionMode: SelectionMode;
  setPrompt: (prompt: string) => void;
  setEditPrompt: (prompt: string) => void;
  setResolution: (resolution: string) => void;
  setStyle: (style: string) => void;
  setSourceType: (sourceType: RenderSourceType) => void;
  setStyleInfluence: (value: number) => void;
  setPreserveStructure: (value: boolean) => void;
  setReferenceImageUrls: (urls: string[]) => void;
  setAtmospherePreset: (label: string | null) => void;
  setEditMode: (mode: EditMode) => void;
  setEditAction: (action: EditAction | null) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  /** Restores a previous render's prompt, style and generation settings. */
  applyRenderSettings: (render: {
    prompt: string;
    style: string;
    resolution: string;
    settings: RenderGenerationSettings | null;
  }) => void;
}

export const useGenerationSettingsStore = create<GenerationSettingsState>((set) => ({
  prompt: "",
  editPrompt: "",
  resolution: "1K",
  style: "Photorealistic",
  sourceType: "photo",
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
  setSourceType: (sourceType) => set({ sourceType }),
  setStyleInfluence: (styleInfluence) => set({ styleInfluence }),
  setPreserveStructure: (preserveStructure) => set({ preserveStructure }),
  setReferenceImageUrls: (referenceImageUrls) => set({ referenceImageUrls }),
  setAtmospherePreset: (atmospherePreset) => set({ atmospherePreset }),
  setEditMode: (editMode) => set({ editMode }),
  setEditAction: (editAction) => set({ editAction }),
  setSelectionMode: (selectionMode) => set({ selectionMode }),
  applyRenderSettings: ({ prompt, style, resolution, settings }) =>
    set((state) => ({
      // Edit jobs restore into the Edit tab's fields; renders into the Render tab's.
      ...(settings?.edit
        ? { editPrompt: prompt, editMode: settings.edit.mode, editAction: settings.edit.action ?? null }
        : { prompt, atmospherePreset: null }),
      style,
      resolution,
      sourceType: settings?.sourceType ?? state.sourceType,
      styleInfluence: settings?.styleInfluence ?? state.styleInfluence,
      preserveStructure: settings?.preserveStructure ?? state.preserveStructure,
      referenceImageUrls: settings?.referenceImageUrls ?? [],
    })),
}));
