/**
 * After a deploy, a tab opened on the previous version asks for code files that no longer
 * exist. That's not a bug in the page, it's an old page: reloading picks up the new version.
 */

const RELOADED_AT_KEY = "renvia:chunk-reload-at";
/** A second failure this soon after reloading means the reload didn't help; stop and explain. */
const RELOAD_GUARD_MS = 30_000;

/** True for the errors browsers and Vite raise when a lazily loaded code file is missing. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (CSS )?chunk [\w-]+ failed|ChunkLoadError/i.test(message);
}

/**
 * Reloads to pick up the new version, at most once per guard window so a genuinely missing
 * file can't put the page in a reload loop. Returns false when it already tried.
 */
export function reloadForNewVersion(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT_KEY) ?? 0);
    if (now - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOADED_AT_KEY, String(now));
  } catch {
    // Without storage there's no way to guard against a loop, so don't reload automatically.
    return false;
  }
  window.location.reload();
  return true;
}
