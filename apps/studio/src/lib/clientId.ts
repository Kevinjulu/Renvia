/**
 * A random id for this browser, kept in localStorage and sent to the API as X-Client-Id. It
 * identifies nothing about the person or device: it only lets the API notice that several
 * accounts were used from the same browser (it stores a keyed hash of it, and only when the
 * operator has switched those signals on). Clearing site data or a private window gives a new
 * one, and a missing one is never held against anyone.
 */
const STORAGE_KEY = "ramah.cid";
let cached: string | null | undefined;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function clientId(): string | null {
  if (cached !== undefined) return cached;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) return (cached = stored);
    const fresh = randomId();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return (cached = fresh);
  } catch {
    // Storage blocked (private mode, a strict browser): send nothing rather than a new id each time.
    return (cached = null);
  }
}
