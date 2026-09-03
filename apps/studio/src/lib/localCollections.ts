const FAVORITES_KEY = "renvia.studio.favorites";
const RECENTLY_VIEWED_KEY = "renvia.studio.recentlyViewed";
const RECENTLY_VIEWED_LIMIT = 5;

export interface RecentlyViewedEntry {
  id: string;
  name: string;
  viewedAt: string;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (private mode, quota) — favoriting/recents just won't persist.
  }
}

export function getFavoriteIds(): string[] {
  return readJson<string[]>(FAVORITES_KEY, []);
}

export function isFavorite(projectId: string): boolean {
  return getFavoriteIds().includes(projectId);
}

export function toggleFavorite(projectId: string): string[] {
  const current = getFavoriteIds();
  const next = current.includes(projectId)
    ? current.filter((id) => id !== projectId)
    : [...current, projectId];
  writeJson(FAVORITES_KEY, next);
  return next;
}

export function getRecentlyViewed(): RecentlyViewedEntry[] {
  return readJson<RecentlyViewedEntry[]>(RECENTLY_VIEWED_KEY, []);
}

export function recordRecentlyViewed(projectId: string, name: string): void {
  const current = getRecentlyViewed().filter((entry) => entry.id !== projectId);
  const next = [{ id: projectId, name, viewedAt: new Date().toISOString() }, ...current].slice(
    0,
    RECENTLY_VIEWED_LIMIT,
  );
  writeJson(RECENTLY_VIEWED_KEY, next);
}

export function renameInRecentlyViewed(projectId: string, name: string): void {
  const next = getRecentlyViewed().map((entry) => (entry.id === projectId ? { ...entry, name } : entry));
  writeJson(RECENTLY_VIEWED_KEY, next);
}

export function removeProjectFromCollections(projectId: string): void {
  writeJson(FAVORITES_KEY, getFavoriteIds().filter((id) => id !== projectId));
  writeJson(RECENTLY_VIEWED_KEY, getRecentlyViewed().filter((entry) => entry.id !== projectId));
}
