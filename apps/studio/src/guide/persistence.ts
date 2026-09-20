import { GUIDE_CATALOG_VERSION } from "./catalog";

const STORAGE_KEY = "renvia.studio.guide";

export interface GuidePersistence {
  catalogVersion: number;
  orientationDone: boolean;
  toursCompleted: string[];
}

const FALLBACK: GuidePersistence = {
  catalogVersion: GUIDE_CATALOG_VERSION,
  orientationDone: false,
  toursCompleted: [],
};

export function readGuidePersistence(): GuidePersistence {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...FALLBACK };
    const parsed = JSON.parse(raw) as Partial<GuidePersistence>;
    return {
      catalogVersion: typeof parsed.catalogVersion === "number" ? parsed.catalogVersion : GUIDE_CATALOG_VERSION,
      orientationDone: Boolean(parsed.orientationDone),
      toursCompleted: Array.isArray(parsed.toursCompleted) ? parsed.toursCompleted.filter((id) => typeof id === "string") : [],
    };
  } catch {
    return { ...FALLBACK };
  }
}

export function writeGuidePersistence(patch: Partial<GuidePersistence>): GuidePersistence {
  const next = { ...readGuidePersistence(), ...patch, catalogVersion: GUIDE_CATALOG_VERSION };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota — the tour still runs for this session
  }
  return next;
}

export function markTourFinished(tourId: string): void {
  const current = readGuidePersistence();
  const toursCompleted = current.toursCompleted.includes(tourId)
    ? current.toursCompleted
    : [...current.toursCompleted, tourId];
  writeGuidePersistence({
    orientationDone: tourId === "orientation" ? true : current.orientationDone,
    toursCompleted,
  });
}
