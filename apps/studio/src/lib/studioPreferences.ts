import type { AspectRatio } from "@renvia/types";

export const STUDIO_PREFERENCES_STORAGE_KEY = "renvia.studio.preferences";

const ASPECT_RATIOS: AspectRatio[] = ["auto", "1:1", "16:9", "4:3", "3:4", "9:16"];

export interface StudioPreferences {
  /** Applied to a fresh Render tab — matches useGenerationSettingsStore's own field names. */
  defaultStyle: string;
  defaultAspectRatio: AspectRatio;
  defaultStyleInfluence: number;
  defaultEditInfluence: number;
  defaultPreserveStructure: boolean;
}

export const DEFAULT_STUDIO_PREFERENCES: StudioPreferences = {
  defaultStyle: "Photorealistic",
  defaultAspectRatio: "auto",
  defaultStyleInfluence: 3,
  defaultEditInfluence: 2,
  defaultPreserveStructure: true,
};

function clampInfluence(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 1 && value <= 4 ? Math.round(value) : fallback;
}

export function readStudioPreferences(): StudioPreferences {
  try {
    const raw = localStorage.getItem(STUDIO_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STUDIO_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<StudioPreferences>;
    return {
      defaultStyle: typeof parsed.defaultStyle === "string" && parsed.defaultStyle ? parsed.defaultStyle : DEFAULT_STUDIO_PREFERENCES.defaultStyle,
      defaultAspectRatio: ASPECT_RATIOS.includes(parsed.defaultAspectRatio as AspectRatio)
        ? (parsed.defaultAspectRatio as AspectRatio)
        : DEFAULT_STUDIO_PREFERENCES.defaultAspectRatio,
      defaultStyleInfluence: clampInfluence(parsed.defaultStyleInfluence, DEFAULT_STUDIO_PREFERENCES.defaultStyleInfluence),
      defaultEditInfluence: clampInfluence(parsed.defaultEditInfluence, DEFAULT_STUDIO_PREFERENCES.defaultEditInfluence),
      defaultPreserveStructure:
        typeof parsed.defaultPreserveStructure === "boolean" ? parsed.defaultPreserveStructure : DEFAULT_STUDIO_PREFERENCES.defaultPreserveStructure,
    };
  } catch {
    return { ...DEFAULT_STUDIO_PREFERENCES };
  }
}

export function writeStudioPreferences(patch: Partial<StudioPreferences>): StudioPreferences {
  const next = { ...readStudioPreferences(), ...patch };
  try {
    localStorage.setItem(STUDIO_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full quota — the change still applies for this session.
  }
  return next;
}
