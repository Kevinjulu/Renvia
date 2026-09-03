import { create } from "zustand";

interface GenerationSettingsState {
  prompt: string;
  resolution: string;
  style: string;
  setPrompt: (prompt: string) => void;
  setResolution: (resolution: string) => void;
  setStyle: (style: string) => void;
}

export const useGenerationSettingsStore = create<GenerationSettingsState>((set) => ({
  prompt: "",
  resolution: "1K",
  style: "Photorealistic",
  setPrompt: (prompt) => set({ prompt }),
  setResolution: (resolution) => set({ resolution }),
  setStyle: (style) => set({ style }),
}));
