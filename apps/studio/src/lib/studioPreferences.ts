import type { AspectRatio } from "@renvia/types";

export const STUDIO_PREFERENCES_STORAGE_KEY = "renvia.studio.preferences";
/**
 * Bumped when a default changes in a way saved preferences should follow. Version 2: Style
 * influence defaults to Maximum, so a stored Strong (the old default) is carried up once.
 */
const PREFERENCES_VERSION = 2;

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
  // Maximum: with a reference it's the level that carries the reference's materials, exact
  // colours and finish all the way through. The structure lock holds at every level, so it
  // doesn't loosen the building's geometry.
  defaultStyleInfluence: 4,
  // Maximum, not Balanced: a weak guidance scale on the edit model under-applies the
  // instruction (partial or no visible change) far more often than it over-applies it.
  defaultEditInfluence: 4,
  defaultPreserveStructure: true,
};

function clampInfluence(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 1 && value <= 4 ? Math.round(value) : fallback;
}

export function readStudioPreferences(): StudioPreferences {
  try {
    const raw = localStorage.getItem(STUDIO_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STUDIO_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<StudioPreferences> & { version?: number };
    // Saved before Maximum became the default: a stored Strong was almost always just the old
    // default written alongside some other change, so it moves up with it. Lower choices stay.
    if ((parsed.version ?? 1) < 2 && parsed.defaultStyleInfluence === 3) parsed.defaultStyleInfluence = 4;
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
    localStorage.setItem(STUDIO_PREFERENCES_STORAGE_KEY, JSON.stringify({ ...next, version: PREFERENCES_VERSION }));
  } catch {
    // Private mode or full quota — the change still applies for this session.
  }
  return next;
}
