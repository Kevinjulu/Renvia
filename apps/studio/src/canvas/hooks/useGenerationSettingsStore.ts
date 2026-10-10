import { create } from "zustand";
import {
  editMethodFor,
  type AspectRatio,
  type EditEnvironment,
  type EditMethod,
  type FidelityMode,
  type ProtectedGeometryFeature,
  type RenderGenerationSettings,
} from "@renvia/types";
import { readStudioPreferences } from "../../lib/studioPreferences";

/** Where an edit lands: the whole render, or only the area selected on it. */
export type EditScope = "whole" | "selection";

export const STYLE_INFLUENCE_LABELS = ["Minimal", "Balanced", "Strong", "Maximum"] as const;

interface GenerationSettingsState {
  prompt: string;
  editPrompt: string;
  aspectRatio: AspectRatio;
  style: string;
  styleInfluence: number;
  /** Edit tab's own strength control — never shares state with the Render tab's. */
  editInfluence: number;
  preserveStructure: boolean;
  fidelityMode: FidelityMode;
  protectedGeometry: ProtectedGeometryFeature[];
  geometryReviewedAt: string | null;
  referenceImageUrls: string[];
  /**
   * Reproduces (locked) or nudges (same seed, new prompt/strength) a previous render.
   * Null means a fresh random seed — the normal case.
   */
  seed: number | null;
  editMethod: EditMethod;
  /** The Edit tab's one reference, kept apart from the Render tab's list. */
  editReferenceUrl: string | null;
  editScope: EditScope;
  editEnvironment: EditEnvironment;
  setPrompt: (prompt: string) => void;
  setEditPrompt: (prompt: string) => void;
  setAspectRatio: (aspectRatio: AspectRatio) => void;
  setStyle: (style: string) => void;
  setStyleInfluence: (value: number) => void;
  setEditInfluence: (value: number) => void;
  setPreserveStructure: (value: boolean) => void;
  setFidelityMode: (mode: FidelityMode) => void;
  setProtectedGeometry: (features: ProtectedGeometryFeature[]) => void;
  confirmGeometryReview: () => void;
  setReferenceImageUrls: (urls: string[]) => void;
  setSeed: (seed: number | null) => void;
  setEditMethod: (method: EditMethod) => void;
  setEditReferenceUrl: (url: string | null) => void;
  setEditScope: (scope: EditScope) => void;
  /**
   * Sets one environment field from its control's option id; undefined leaves that part of the
   * scene as it is. Ids come from the fixed option lists, which match the API's enums.
   */
  setEditEnvironment: (key: keyof EditEnvironment, value: string | undefined) => void;
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
  styleInfluence: preferences.defaultStyleInfluence,
  editInfluence: preferences.defaultEditInfluence,
  preserveStructure: preferences.defaultPreserveStructure,
  fidelityMode: "strict",
  protectedGeometry: ["silhouette", "roof", "openings", "massing", "camera"],
  geometryReviewedAt: null,
  referenceImageUrls: [],
  seed: null,
  editMethod: "prompt",
  editReferenceUrl: null,
  editScope: "whole",
  editEnvironment: {},
  setPrompt: (prompt) => set({ prompt }),
  setEditPrompt: (editPrompt) => set({ editPrompt }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setStyle: (style) => set({ style }),
  setStyleInfluence: (styleInfluence) => set({ styleInfluence }),
  setEditInfluence: (editInfluence) => set({ editInfluence }),
  setPreserveStructure: (preserveStructure) => set({ preserveStructure }),
  setFidelityMode: (fidelityMode) => set({ fidelityMode, geometryReviewedAt: null }),
  setProtectedGeometry: (protectedGeometry) => set({ protectedGeometry, geometryReviewedAt: null }),
  confirmGeometryReview: () => set({ geometryReviewedAt: new Date().toISOString() }),
  // A reference image is a style/material input. It must never silently turn a source drawing
  // into a request to recreate the reference building, so attaching one locks structure here
  // and the API repeats the same guard for older clients and direct requests.
  setReferenceImageUrls: (referenceImageUrls) =>
    set((state) => ({
      referenceImageUrls,
      preserveStructure: referenceImageUrls.length > 0 ? true : state.preserveStructure,
    })),
  setSeed: (seed) => set({ seed }),
  setEditMethod: (editMethod) => set({ editMethod }),
  setEditReferenceUrl: (editReferenceUrl) => set({ editReferenceUrl }),
  setEditScope: (editScope) => set({ editScope }),
  setEditEnvironment: (key, value) =>
    set((state) => {
      const editEnvironment = { ...state.editEnvironment };
      if (value === undefined) delete editEnvironment[key];
      else (editEnvironment as Record<keyof EditEnvironment, string>)[key] = value;
      return { editEnvironment };
    }),
  applyRenderSettings: ({ prompt, style, aspectRatio, seed, settings }) =>
    set((state) => {
      const shared = { style, aspectRatio: (aspectRatio as AspectRatio) || "auto", seed };
      // Edit jobs restore into the Edit tab's fields and leave the Render tab's alone.
      if (settings?.edit) {
        const editReferenceUrl = settings.referenceImageUrls?.[0] ?? null;
        return {
          ...shared,
          editPrompt: prompt,
          editMethod: editMethodFor(settings.edit, { hasReferences: editReferenceUrl !== null, hasPrompt: prompt.trim() !== "" }),
          editReferenceUrl,
          editScope: settings.edit.maskImageUrl ? "selection" : "whole",
          editEnvironment: settings.edit.environment ?? {},
          editInfluence: settings.editInfluence ?? state.editInfluence,
        };
      }
      return {
        ...shared,
        prompt,
        styleInfluence: settings?.styleInfluence ?? state.styleInfluence,
        preserveStructure: settings?.referenceImageUrls?.length ? true : (settings?.preserveStructure ?? state.preserveStructure),
        fidelityMode: settings?.fidelity?.mode ?? state.fidelityMode,
        protectedGeometry: settings?.fidelity?.protectedFeatures ?? state.protectedGeometry,
        geometryReviewedAt: settings?.fidelity?.reviewedAt ?? null,
        referenceImageUrls: settings?.referenceImageUrls ?? [],
      };
    }),
}));
