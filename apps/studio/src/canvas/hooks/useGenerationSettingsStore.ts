import { create } from "zustand";
import type { AspectRatio, EditAction, EditMode, RenderGenerationSettings, RenderSourceType } from "@renvia/types";
import { readStudioPreferences } from "../../lib/studioPreferences";

export type { EditAction, EditMode };
export type SelectionMode = "auto" | "manual";

/**
 * Which edit the inputs describe, so the panel doesn't ask. A reference aimed at a selected
 * part borrows its material; a reference with nothing selected restyles the whole building.
 * Without a reference, picking Add/Remove/Change still needs "element" so the API layer
 * builds an action verb around the prompt instead of passing it through unchanged — plain
 * "prompt" is for a sentence with no verb chip picked.
 */
export function inferEditMode({
  hasReferences,
  hasSelection,
  hasAction,
}: {
  hasReferences: boolean;
  hasSelection: boolean;
  hasAction: boolean;
}): EditMode {
  if (hasReferences) return hasSelection ? "element" : "building";
  return hasAction ? "element" : "prompt";
}

export const STYLE_INFLUENCE_LABELS = ["Minimal", "Balanced", "Strong", "Maximum"] as const;

interface GenerationSettingsState {
  prompt: string;
  editPrompt: string;
  aspectRatio: AspectRatio;
  style: string;
  sourceType: RenderSourceType;
  styleInfluence: number;
  /** Edit tab's own strength control — never shares state with the Render tab's. */
  editInfluence: number;
  preserveStructure: boolean;
  referenceImageUrls: string[];
  /**
   * Reproduces (locked) or nudges (same seed, new prompt/strength) a previous render.
   * Null means a fresh random seed — the normal case.
   */
  seed: number | null;
  /** UI-only: which quick-atmosphere chip filled the prompt. */
  atmospherePreset: string | null;
  editMode: EditMode;
  /** False once the user picks a mode by hand, which stops inference overriding them. */
  editModeAuto: boolean;
  editAction: EditAction | null;
  selectionMode: SelectionMode;
  /** Part of the building the edit targets, `WHOLE_IMAGE`, or null while nothing is chosen. */
  selectedPart: string | null;
  setPrompt: (prompt: string) => void;
  setEditPrompt: (prompt: string) => void;
  setAspectRatio: (aspectRatio: AspectRatio) => void;
  setStyle: (style: string) => void;
  setSourceType: (sourceType: RenderSourceType) => void;
  setStyleInfluence: (value: number) => void;
  setEditInfluence: (value: number) => void;
  setPreserveStructure: (value: boolean) => void;
  setReferenceImageUrls: (urls: string[]) => void;
  setSeed: (seed: number | null) => void;
  setAtmospherePreset: (label: string | null) => void;
  setEditMode: (mode: EditMode) => void;
  /** Sets the mode the inputs imply, unless the user has chosen one themselves. */
  applyInferredEditMode: (mode: EditMode) => void;
  setEditAction: (action: EditAction | null) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  setSelectedPart: (part: string | null) => void;
  /** Restores a previous render's prompt, style and generation settings. */
  applyRenderSettings: (render: {
    prompt: string;
    style: string;
    aspectRatio: string;
    seed: number | null;
    settings: RenderGenerationSettings | null;
  }) => void;
}

// Read once at module load — a Studio Settings change takes effect on the next
// project/reload, matching every other per-tab default in this store.
const preferences = readStudioPreferences();

export const useGenerationSettingsStore = create<GenerationSettingsState>((set) => ({
  prompt: "",
  editPrompt: "",
  aspectRatio: preferences.defaultAspectRatio,
  style: preferences.defaultStyle,
  sourceType: "photo",
  styleInfluence: preferences.defaultStyleInfluence,
  editInfluence: preferences.defaultEditInfluence,
  preserveStructure: preferences.defaultPreserveStructure,
  referenceImageUrls: [],
  seed: null,
  atmospherePreset: null,
  editMode: "prompt",
  editModeAuto: true,
  editAction: null,
  selectionMode: "auto",
  selectedPart: null,
  setPrompt: (prompt) => set({ prompt }),
  setEditPrompt: (editPrompt) => set({ editPrompt }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setStyle: (style) => set({ style }),
  setSourceType: (sourceType) => set({ sourceType }),
  setStyleInfluence: (styleInfluence) => set({ styleInfluence }),
  setEditInfluence: (editInfluence) => set({ editInfluence }),
  setPreserveStructure: (preserveStructure) => set({ preserveStructure }),
  setReferenceImageUrls: (referenceImageUrls) => set({ referenceImageUrls }),
  setSeed: (seed) => set({ seed }),
  setAtmospherePreset: (atmospherePreset) => set({ atmospherePreset }),
  setEditMode: (editMode) => set({ editMode, editModeAuto: false }),
  applyInferredEditMode: (editMode) => set((state) => (state.editModeAuto ? { editMode } : {})),
  setEditAction: (editAction) => set({ editAction }),
  setSelectionMode: (selectionMode) => set({ selectionMode }),
  setSelectedPart: (selectedPart) => set({ selectedPart }),
  applyRenderSettings: ({ prompt, style, aspectRatio, seed, settings }) =>
    set((state) => ({
      // Edit jobs restore into the Edit tab's fields; renders into the Render tab's.
      ...(settings?.edit
        ? { editPrompt: prompt, editMode: settings.edit.mode, editModeAuto: false, editAction: settings.edit.action ?? null }
        : { prompt, atmospherePreset: null }),
      style,
      aspectRatio: (aspectRatio as AspectRatio) || "auto",
      seed,
      sourceType: settings?.sourceType ?? state.sourceType,
      styleInfluence: settings?.styleInfluence ?? state.styleInfluence,
      editInfluence: settings?.editInfluence ?? state.editInfluence,
      preserveStructure: settings?.preserveStructure ?? state.preserveStructure,
      referenceImageUrls: settings?.referenceImageUrls ?? [],
    })),
}));
